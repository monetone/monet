import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Ruler ▸ Straighten Layer ─────────────────────────────
// Adobe: drag the Ruler along something that should be straight, then click
// "Straighten Layer" — the image rotates so that line becomes axis-aligned (the
// canvas grows to fit). Vision adds the button + the pure angle math in
// src/state/straighten.ts, rotating via the existing rotate_arbitrary.
//   https://helpx.adobe.com/photoshop/using/adjusting-crop-rotation-canvas.html

async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "ruler-straighten");
    mv.engine.commit();
    mv.store.setTool("ruler");
  });
  await expect(page.locator("#mv-ruler-straighten")).toBeVisible();
}

const dims = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));
const setRuler = (page: Page, line: { x0: number; y0: number; x1: number; y1: number }): Promise<void> =>
  page.evaluate((l) => (window as any).__mv.store.setRulerLine(l), line);
const rulerLine = (page: Page): Promise<unknown> =>
  page.evaluate(() => (window as any).__mv.store.state.rulerLine);

test("the ruler tool shows a Straighten Layer button (disabled with no measure line)", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-ruler-straighten")).toBeDisabled();
});

test("straightening a tilted measure line rotates and grows the canvas, then clears the line", async ({ page }) => {
  await scene(page);
  const before = await dims(page);
  await setRuler(page, { x0: 10, y0: 10, x1: 110, y1: 50 }); // dx=100, dy=40 → ~21.8° tilt
  await expect(page.locator("#mv-ruler-straighten")).toBeEnabled();
  await page.locator("#mv-ruler-straighten").click();
  const after = await dims(page);
  expect(after.w).toBeGreaterThan(before.w); // rotate_arbitrary grew the canvas
  expect(after.h).toBeGreaterThan(before.h);
  expect(await rulerLine(page)).toBeNull(); // measure line cleared
});

test("straightening an already-horizontal line leaves the canvas size unchanged", async ({ page }) => {
  await scene(page);
  const before = await dims(page);
  await setRuler(page, { x0: 10, y0: 80, x1: 190, y1: 80 }); // dy=0 → 0° → no rotation
  await page.locator("#mv-ruler-straighten").click();
  const after = await dims(page);
  expect(after).toEqual(before);
  expect(await rulerLine(page)).toBeNull();
});
