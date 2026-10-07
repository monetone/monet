import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ Spherize — Mode ───────────────────
// PS Spherize has a Mode dropdown: Normal (a 2-D spherical bulge) plus
// Horizontal Only and Vertical Only (cylindrical — the bulge acts on one axis
// and the other passes straight through). Monet shipped Normal only; this adds
// the two cylindrical modes.
//   https://helpx.adobe.com/photoshop/using/distort-filters.html

const D = 24;

async function red(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });
}

// Grey that ramps with Y only (horizontal bands) — a pattern a Y-axis remap
// changes but an X-axis remap cannot.
async function yRampDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "spherize");
    const E = mv.engine.engine; // capture AFTER newDocument
    for (let y = 0; y < d; y++) { E.select_rect(0, y, d, 1, 0); const v = Math.min(255, 20 + y * 8); E.fill_selection(v, v, v, 255); }
    E.select_none();
    mv.engine.commit();
  }, D);
}

// Grey that ramps with X only (vertical stripes).
async function xRampDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "spherize");
    const E = mv.engine.engine;
    for (let x = 0; x < d; x++) { E.select_rect(x, 0, 1, d, 0); const v = Math.min(255, 20 + x * 8); E.fill_selection(v, v, v, 255); }
    E.select_none();
    mv.engine.commit();
  }, D);
}

async function openDistortDialog(page: Page, label: "Pinch…" | "Spherize…") {
  const command = `Filter ▸ Distort ▸ ${label}`;
  await page.evaluate((exact) => {
    const item = (window as any).__mv.commandPalette.items.find((candidate: any) => candidate.label === exact);
    if (!item) throw new Error(`Missing command: ${exact}`);
    item.run();
  }, command);
}

// ── Horizontal Only remaps X, not Y ────────────────────────────────
test("Horizontal Only leaves a Y-only pattern unchanged; Normal changes it", async ({ page }) => {
  await yRampDoc(page);
  const base = await red(page, 6, 6);
  await page.evaluate(() => (window as any).__mv.distort.spherize(0.6, 1)); // Horizontal Only
  expect(await red(page, 6, 6)).toBe(base);
  await yRampDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.spherize(0.6, 0)); // Normal
  expect(await red(page, 6, 6)).not.toBe(base);
});

// ── Vertical Only remaps Y, not X ──────────────────────────────────
test("Vertical Only leaves an X-only pattern unchanged; Normal changes it", async ({ page }) => {
  await xRampDoc(page);
  const base = await red(page, 6, 6);
  await page.evaluate(() => (window as any).__mv.distort.spherize(0.6, 2)); // Vertical Only
  expect(await red(page, 6, 6)).toBe(base);
  await xRampDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.spherize(0.6, 0)); // Normal
  expect(await red(page, 6, 6)).not.toBe(base);
});

// ── Normal mode still distorts, and the one-arg call defaults to it ─
// (back-compat: the dialog's Apply and existing callers pass no mode.)
test("Normal mode distorts, and the one-arg call defaults to Normal", async ({ page }) => {
  await yRampDoc(page);
  const base = await red(page, 6, 6);
  await page.evaluate(() => (window as any).__mv.distort.spherize(0.6, 0)); // explicit Normal
  const explicit = await red(page, 6, 6);
  expect(explicit).not.toBe(base); // Normal remaps the image
  await yRampDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.spherize(0.6)); // one-arg → default mode
  expect(await red(page, 6, 6)).toBe(explicit); // identical to explicit Normal
});

test("Pinch and Spherize use separate dialogs and opposite signed warps", async ({ page }) => {
  await xRampDoc(page);
  const base = await red(page, 6, 11);
  await openDistortDialog(page, "Pinch…");
  const pinchDialog = page.getByRole("dialog", { name: "Pinch" });
  await expect(pinchDialog).toBeVisible();
  await expect(pinchDialog.getByText("Mode", { exact: true })).toHaveCount(0);
  const pinchAmount = pinchDialog.locator(".monet-row").filter({ hasText: "Amount" }).first();
  const pinchSlider = pinchAmount.getByRole("slider", { name: "Amount" });
  await expect(pinchSlider).toHaveAttribute("aria-valuemin", "-100");
  await expect(pinchSlider).toHaveAttribute("aria-valuemax", "100");
  await pinchSlider.press("Home");
  await expect(pinchAmount).toContainText("-100%");
  await pinchSlider.press("End");
  await expect(pinchAmount).toContainText("100%");
  await pinchDialog.getByRole("button", { name: "OK", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_label())).toBe("Pinch");
  const pinched = await red(page, 6, 11);

  await xRampDoc(page);
  await openDistortDialog(page, "Spherize…");
  const spherizeDialog = page.getByRole("dialog", { name: "Spherize" });
  await expect(spherizeDialog).toBeVisible();
  await expect(spherizeDialog.getByRole("combobox", { name: "Mode" })).toBeVisible();
  const spherizeAmount = spherizeDialog.locator(".monet-row").filter({ hasText: "Amount" }).first();
  const spherizeSlider = spherizeAmount.getByRole("slider", { name: "Amount" });
  await spherizeSlider.press("Home");
  await expect(spherizeAmount).toContainText("-100%");
  await spherizeSlider.press("End");
  await expect(spherizeAmount).toContainText("100%");
  await spherizeDialog.getByRole("button", { name: "OK", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_label())).toBe("Spherize");
  const spherized = await red(page, 6, 11);

  expect(pinched).toBeLessThan(base);
  expect(spherized).toBeGreaterThan(base);
});
