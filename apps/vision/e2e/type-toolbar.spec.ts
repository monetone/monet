import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// The type editor is a top-docked TOOLBAR (in the options bar), shown whenever a
// type layer is the active layer — never a modal popup. These tests drive the
// real DOM (the options-bar toolbar) plus `window.__mv` for engine assertions.

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

const content = (page: import("@playwright/test").Page) => page.getByLabel("Text content");
const warpBtn = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /Warp \/ FX/ });
const activeKind = (page: import("@playwright/test").Page) =>
  page.evaluate(() => { const mv = (window as any).__mv; return mv.engine.engine.layer_kind(mv.store.state.activeLayerId); });

async function runExactCommand(page: import("@playwright/test").Page, label: string) {
  await page.waitForFunction((exact) =>
    (window as any).__mv.commandPalette?.items?.some((item: any) => item.label === exact), label, { timeout: 5000 });
  await page.evaluate((exact) =>
    (window as any).__mv.commandPalette.items.find((item: any) => item.label === exact).run(), label);
}

test("creating a text layer shows the docked toolbar, not a modal", async ({ page }) => {
  // A non-text layer is active to start, so the type toolbar is absent.
  await expect(content(page)).toHaveCount(0);

  const id = await page.evaluate(() => (window as any).__mv.text.createAt(40, 60));

  // The new layer is a live type layer and is active…
  expect(await activeKind(page)).toBe(2);
  expect(await page.evaluate((layerId) => (window as any).__mv.engine.engine.layer_name(layerId), id)).toBe("Text Layer 1");
  const layerRow = page.locator(`[role="option"][id="${id}"]`);
  await expect(layerRow).toContainText("Text Layer 1");
  await expect(layerRow.getByRole("img", { name: "Text layer" })).toBeVisible();
  // …the editor appears as a docked toolbar (textarea + Warp/FX button)…
  await expect(content(page)).toBeVisible();
  await expect(warpBtn(page)).toBeVisible();
  // …and crucially NO modal dialog popped up.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(id).toBeGreaterThan(0);
});

test("the toolbar edits the active type layer's text live", async ({ page }) => {
  const id = await page.evaluate(() => (window as any).__mv.text.createAt(40, 60));
  await expect(content(page)).toBeVisible();

  await content(page).fill("Hi there");
  const text = await page.evaluate((tid) => {
    const mv = (window as any).__mv; return mv.text.fullText(mv.text.get(tid));
  }, id);
  expect(text).toBe("Hi there");
});

test("the toolbar kerning dropdown writes the active type spec", async ({ page }) => {
  const id = await page.evaluate(() => (window as any).__mv.text.createAt(40, 60));
  await expect(content(page)).toBeVisible();

  await page.getByLabel("Kerning").click();
  await page.getByRole("option", { name: "Optical" }).click();

  const kerning = await page.evaluate((tid) => {
    const mv = (window as any).__mv;
    return mv.text.resolveStyle(mv.text.get(tid), mv.text.get(tid).runs[0]).kerning;
  }, id);
  expect(kerning).toBe("optical");
});

test("the toolbar tracks layer selection — shows only for type layers", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.text.createAt(40, 60));
  await expect(content(page)).toBeVisible();

  // Select the (non-text) Background layer → the toolbar goes away.
  const bg = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    let id = -1;
    for (let i = 0; i < E().layer_count(); i++) { const lid = E().layer_id_at(i); if (E().layer_kind(lid) !== 2) id = lid; }
    mv.store.selectLayer(id);
    return id;
  });
  expect(bg).toBeGreaterThanOrEqual(0);
  await expect(content(page)).toHaveCount(0);

  // Reselect the type layer → the toolbar comes back.
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    for (let i = 0; i < E().layer_count(); i++) { const lid = E().layer_id_at(i); if (E().layer_kind(lid) === 2) mv.store.selectLayer(lid); }
  });
  await expect(content(page)).toBeVisible();
});

test("the Warp / FX… button still opens the advanced Type dialog", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.text.createAt(40, 60));
  await expect(warpBtn(page)).toBeVisible();

  await warpBtn(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the font dropdown is an opaque liquid-glass panel, not see-through", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.text.createAt(40, 60));
  await expect(content(page)).toBeVisible();

  await page.getByLabel("Font", { exact: true }).click();
  const box = page.locator(".monet-listbox");
  await expect(box).toBeVisible();

  const bg = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.backgroundColor, image: s.backgroundImage };
  });
  // An opaque base — alpha well above the translucent --glass-2 default (~0.09)
  // that let the toolbar/canvas bleed through when nested in the blurred bar.
  const parts = (bg.color.match(/rgba?\(([^)]+)\)/)?.[1] ?? "").split(",").map((x) => parseFloat(x.trim()));
  const alpha = parts.length === 4 ? parts[3] : 1;
  expect(alpha).toBeGreaterThan(0.6);
  // …with a top-down sheen for the liquid-glass look.
  expect(bg.image).toContain("gradient");
});

test("Type ▸ Font Preview Size styles both font pickers and persists as an app preference", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.markActiveSaved());
  await runExactCommand(page, "Type ▸ Font Preview Size ▸ Huge");
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      size: mv.store.state.fontPreviewSize,
      saved: localStorage.getItem("mv.fontPreviewSize"),
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  })).toEqual({ size: "huge", saved: "huge", dirty: false });

  await page.reload();
  await page.waitForFunction(() => { const mv = (window as any).__mv; return mv?.engine && mv.store?.state?.fontPreviewSize === "huge"; }, null, { timeout: 30_000 });
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(256, 192, "e2e"); mv.text.createAt(40, 60); }); // a reload opens no document
  await page.getByLabel("Font", { exact: true }).click();
  const georgia = page.getByRole("option", { name: "Georgia", exact: true });
  const huge = await georgia.evaluate((element) => ({
    family: getComputedStyle(element).fontFamily,
    size: parseFloat(getComputedStyle(element).fontSize),
    height: parseFloat(getComputedStyle(element).minHeight),
    inline: element.getAttribute("style"),
  }));
  expect(huge.family).toContain("Georgia");
  expect(huge.size).toBe(30);
  expect(huge.height).toBe(44);
  expect(huge.inline).toContain("font-family");
  await page.keyboard.press("Escape");

  await warpBtn(page).click();
  const typeDialog = page.getByRole("dialog");
  await typeDialog.locator(".monet-select").first().getByRole("combobox").click();
  const advanced = await page.getByRole("option", { name: "Georgia", exact: true }).evaluate((element) => ({
    family: getComputedStyle(element).fontFamily,
    size: parseFloat(getComputedStyle(element).fontSize),
  }));
  expect(advanced.family).toContain("Georgia");
  expect(advanced.size).toBe(30);
  await page.getByRole("option", { name: "Georgia", exact: true }).click();
  await typeDialog.getByRole("button", { name: "Cancel" }).click();

  await runExactCommand(page, "Type ▸ Font Preview Size ▸ None");
  await page.getByLabel("Font", { exact: true }).click();
  expect(await page.getByRole("option", { name: "Georgia", exact: true }).getAttribute("style")).toBeNull();
  expect(await page.evaluate(() => (window as any).__mv.store.state.fontPreviewSize)).toBe("none");
});

test("rasterizing the type layer dismisses the toolbar", async ({ page }) => {
  const id = await page.evaluate(() => (window as any).__mv.text.createAt(40, 60));
  await expect(content(page)).toBeVisible();

  await page.evaluate((tid) => (window as any).__mv.text.rasterizeLayer(tid), id);
  expect(await activeKind(page)).toBe(0);          // now a normal raster layer
  await expect(content(page)).toHaveCount(0);      // toolbar gone
});
