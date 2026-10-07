import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop View ▸ Snap To (granular targets) ────────────────────
// Adobe: Snap To toggles which targets snapping aligns to (Guides / Grid /
// Document Bounds …), independent of the master Snap toggle. Vision drives
// snapToGuides (exposed as __mv.snap) from the snapGuides/snapGrid/snapDocBounds
// flags. Zoom is pinned to 1 so the threshold is a deterministic 6 doc-px.
//   https://helpx.adobe.com/photoshop/using/snapping.html

test("snapping aligns to guides only when Snap To ▸ Guides is on", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "snap");
    mv.store.setOptions({ snapEnabled: true, snapGuides: true, snapGrid: false, snapDocBounds: false });
    mv.store.addGuide("v", 50);
  });
  let x = await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setZoom(1); return mv.snap(53, 10).x; });
  expect(x).toBe(50);
  await page.evaluate(() => (window as any).__mv.store.toggleView("snapGuides"));
  x = await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setZoom(1); return mv.snap(53, 10).x; });
  expect(x).toBe(53);
});

test("snapping aligns to document bounds and grid per target", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "snap2");
    mv.store.setOptions({ snapEnabled: true, snapGuides: false, snapGrid: false, snapDocBounds: true });
  });
  let p = await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setZoom(1); return mv.snap(3, 3); });
  expect(p).toEqual({ x: 0, y: 0 });

  await page.evaluate(() => (window as any).__mv.store.setOptions({ snapDocBounds: false, snapGrid: true, showGrid: true, showExtras: true, gridSpacing: 32 }));
  p = await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setZoom(1); return mv.snap(30, 30); });
  expect(p).toEqual({ x: 32, y: 32 });
});
