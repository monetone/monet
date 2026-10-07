import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// #442 — Image ▸ Mode ▸ Indexed Color / Bitmap and Image ▸ Adjustments ▸
// Shadows/Highlights reopen with the values their last OK used; Bitmap's Output
// resolution becomes the document's; and Color Table opens on (and edits) the
// palette the conversion gave the document, which is flattened to one layer.

async function openCommand(page: Page, label: string) {
  await page.evaluate((suffix) => {
    const items = (window as any).__mv.commandPalette.items as Array<{ label: string; run: () => void }>;
    const item = items.find((i) => typeof i.label === "string" && i.label.endsWith(suffix));
    if (!item) throw new Error(`no command ending in ${suffix}`);
    item.run();
  }, label);
  return page.getByRole("dialog");
}

async function pick(page: Page, combobox: string, option: string) {
  await page.getByRole("dialog").getByRole("combobox", { name: combobox }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function fieldIn(page: Page, row: string) {
  return page.getByRole("dialog").locator(".monet-row", { hasText: row }).locator("input");
}

const rgbAt = (page: Page, x: number, y: number) => page.evaluate(({ x, y }) => {
  const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
}, { x, y });

test("Indexed Color reopens on its last values and Color Table edits the flattened document's palette", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "indexed");
    const E = mv.engine.engine;
    E.add_layer("Art");
    E.select_rect(0, 0, 16, 32, 0); E.fill_selection(250, 10, 10, 255); // near-red, on the upper layer
    E.select_none();
    mv.engine.commit();
  });
  expect(await page.evaluate(() => (window as any).__mv.store.state.layers.length)).toBe(2);

  // Color Table ▸ Apply re-indexes the document, so it flattens it too — and says so.
  let dialog = await openCommand(page, "Color Table…");
  await expect(dialog.getByText("Apply flattens the 2 layers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  dialog = await openCommand(page, "Indexed Color…");
  await expect(dialog.getByText("OK flattens the 2 layers")).toBeVisible();
  await pick(page, "Palette", "Web");
  await pick(page, "Forced", "Primaries");
  await dialog.getByLabel("Matte").fill("#ff0000");
  await dialog.getByRole("checkbox", { name: "Dither (Diffusion)" }).click();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();

  expect(await page.evaluate(() => (window as any).__mv.store.state.layers.length), "flattened").toBe(1);
  expect(await rgbAt(page, 4, 4), "Forced ▸ Primaries' red holds the near-red").toEqual([255, 0, 0]);

  dialog = await openCommand(page, "Indexed Color…");
  await expect(dialog.getByRole("combobox", { name: "Palette" })).toContainText("Web");
  await expect(dialog.getByRole("combobox", { name: "Forced" })).toContainText("Primaries");
  await expect(dialog.getByLabel("Matte")).toHaveValue("#ff0000");
  await expect(dialog.getByRole("checkbox", { name: "Dither (Diffusion)" })).toHaveAttribute("aria-checked", "false");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Primaries take the first 8 slots, the 216-entry web cube the rest.
  dialog = await openCommand(page, "Color Table…");
  await expect(dialog.getByText("224 colors in the document palette")).toBeVisible();
  const entries = dialog.locator("[data-mv-colortable-entry]");
  await expect(entries).toHaveCount(224);
  await expect(entries.nth(2)).toHaveValue("#ff0000");
  await entries.nth(2).fill("#00ff00");
  await dialog.locator("[data-mv-colortable-apply]").click();
  await expect(dialog).toBeHidden();
  expect(await rgbAt(page, 4, 4), "the edited slot recolours its pixels").toEqual([0, 255, 0]);
  expect(await rgbAt(page, 24, 4), "the white slot is untouched").toEqual([255, 255, 255]);

  dialog = await openCommand(page, "Color Table…");
  await expect(dialog.locator("[data-mv-colortable-entry]").nth(2), "the edit is the palette now").toHaveValue("#00ff00");
});

test("Bitmap's Output resolution becomes the document's, and the dialog reopens on it", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 30, "bitmap", "white", 1, { resolutionPpi: 72 });
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 30, 0); E.fill_selection(128, 128, 128, 255);
    E.select_none();
    mv.engine.commit();
  });

  let dialog = await openCommand(page, "Bitmap…");
  await dialog.getByRole("radio", { name: "Halftone Screen" }).click();
  const output = await fieldIn(page, "Output");
  await output.fill("144");
  await output.press("Enter");
  const frequency = await fieldIn(page, "Frequency");
  await frequency.fill("30");
  await frequency.press("Enter");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();

  const doc = () => page.evaluate(() => {
    const mv = (window as any).__mv;
    return [mv.engine.engine.width(), mv.engine.engine.height(), mv.store.state.resolutionPpi];
  });
  expect(await doc(), "resampled 2× and restamped").toEqual([80, 60, 144]);

  dialog = await openCommand(page, "Bitmap…");
  await expect(dialog.getByText("144 ppi")).toBeVisible(); // Input is the document's now
  await expect(dialog.getByRole("radio", { name: "Halftone Screen" })).toHaveAttribute("aria-checked", "true");
  await expect(await fieldIn(page, "Output")).toHaveValue("144");
  await expect(await fieldIn(page, "Frequency")).toHaveValue("30");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await doc(), "one Undo puts back size and ppi").toEqual([40, 30, 72]);
});

// The verifier's repro: an Output left alone on a 72 ppi document must not
// resample the next, 300 ppi, one down to 72. And Bitmap is single-layer like
// Photoshop's: a layered document is flattened, the whole image goes 1-bit.
test("an untouched Bitmap Output follows each document, and a layered one is flattened", async ({ page }) => {
  await gotoApp(page);
  const doc = () => page.evaluate(() => {
    const mv = (window as any).__mv;
    return [mv.engine.engine.width(), mv.engine.engine.height(), mv.store.state.resolutionPpi, mv.store.state.layers.length];
  });
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 30, "A", "white", 1, { resolutionPpi: 72 }));
  let dialog = await openCommand(page, "Bitmap…");
  await expect(await fieldIn(page, "Output")).toHaveValue("72");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await doc()).toEqual([40, 30, 72, 1]);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 30, "B", "white", 1, { resolutionPpi: 300 });
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 30, 0); E.fill_selection(40, 40, 40, 255); // dark Background
    E.add_layer("Art");
    E.select_rect(20, 0, 20, 30, 0); E.fill_selection(220, 220, 220, 255); // light right half
    E.select_none();
    mv.engine.commit();
  });
  dialog = await openCommand(page, "Bitmap…");
  await expect(await fieldIn(page, "Output"), "B's own resolution, not A's").toHaveValue("300");
  await expect(dialog.getByText("OK flattens the 2 layers")).toBeVisible();
  await dialog.getByRole("radio", { name: "50% Threshold" }).click();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await doc(), "not resampled, and flattened").toEqual([40, 30, 300, 1]);
  expect(await rgbAt(page, 5, 5), "the Background went 1-bit too").toEqual([0, 0, 0]);
  expect(await rgbAt(page, 30, 5)).toEqual([255, 255, 255]);
});

test("Shadows/Highlights reopens on its last Radius, clip and amount", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "shadows-highlights"));

  let dialog = await openCommand(page, "Shadows/Highlights…");
  await dialog.getByRole("slider", { name: "Radius" }).first().press("PageUp"); // 30 → 40 px
  await dialog.getByRole("slider", { name: "Amount" }).nth(1).press("PageUp"); // highlights 0 → 10 %
  await dialog.getByRole("slider", { name: "Black Clip" }).press("PageUp"); // 0.01 → 0.11 %
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();

  dialog = await openCommand(page, "Shadows/Highlights…");
  await expect(dialog.getByRole("slider", { name: "Radius" }).first()).toHaveAttribute("aria-valuenow", "40");
  await expect(dialog.getByRole("slider", { name: "Amount" }).nth(1)).toHaveAttribute("aria-valuenow", "10");
  await expect(dialog.getByRole("slider", { name: "Black Clip" })).toHaveAttribute("aria-valuenow", "0.11");
  await expect(dialog.getByRole("slider", { name: "Amount" }).first(), "an untouched control keeps its value").toHaveAttribute("aria-valuenow", "35");
});
