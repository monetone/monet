import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Crosshatch ────────────────────────────
// Adobe: Crosshatch lays diagonal pencil hatching that follows the tones — shadows
// get denser/darker hatch lines, highlights stay clean. Vision adds a new engine
// filter (filter_crosshatch) via the established recipe. pick_color reads back
// 8-bit channels (engine is 16-bit internally); thresholds here are 8-bit (0..255).
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const sampleR = (page: Page) =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const pts = [[5, 5], [12, 8], [19, 14], [26, 6], [33, 11], [8, 22], [17, 28], [24, 19], [31, 31], [13, 35], [29, 24], [21, 3]];
    return pts.map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });

async function flatFill(page: Page, v: number) {
  await page.evaluate((val) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "crosshatch");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(val, val, val, 255);
    E.select_none();
    mv.engine.commit();
  }, v);
}

test("Crosshatch hatches and darkens a midtone, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await flatFill(page, 128);
  const before = await sampleR(page);
  expect(new Set(before).size).toBe(1); // perfectly flat to start

  await page.evaluate(() => (window as any).__mv.fil.crosshatch(0.2, 0.3, 0.8));
  const after = await sampleR(page);
  expect(new Set(after).size).toBeGreaterThan(1); // hatching → the samples vary
  const mean = after.reduce((a, b) => a + b, 0) / after.length;
  expect(mean).toBeLessThan(128); // hatching only darkens

  await page.evaluate(() => (window as any).__mv.store.undo());
  const undone = await sampleR(page);
  expect(new Set(undone).size).toBe(1); // undo restores the flat field
  expect(undone[0]).toBe(128);
});

test("Crosshatch leaves a white field clean", async ({ page }) => {
  await gotoApp(page);
  await flatFill(page, 255);
  await page.evaluate(() => (window as any).__mv.fil.crosshatch(0.2, 0.3, 0.8));
  const after = await sampleR(page);
  expect(new Set(after).size).toBe(1); // highlights get no hatching
  expect(after[0]).toBe(255);
});

test("the Crosshatch dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await flatFill(page, 128);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Crosshatch…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Crosshatch…")).run());
  await expect(page.getByText("Stroke Length")).toBeVisible();
});
