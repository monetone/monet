import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Navigator panel ──────────────────────────────────────
// Adobe: the Navigator panel shows a thumbnail of the whole image with a coloured
// view box outlining the part currently visible in the window; a zoom slider +
// percentage change magnification, and dragging the box scrolls the image.
// Vision adds a Navigator dock panel driven by the pure geometry in
// src/state/navigator.ts (visibleDocRect / thumbBox / viewRectInThumb / panForCenter).
//   https://helpx.adobe.com/photoshop/using/adjusting-image-views.html

/** Fresh 400×300 doc with a known viewport, Navigator tab surfaced. */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(400, 300, "nav");
    const E = mv.engine.engine; // after newDocument: the new doc's active engine
    E.select_all(); E.fill_selection(80, 120, 200, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="navigator"]').click();
  // Pin a known viewport + view state AFTER the new-doc fit layout effect has run
  // (newDocument bumps fitNonce → CanvasView setZoom(fit); set zoom here so it sticks).
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setViewport(200, 150);
    mv.store.setZoom(1, 0, 0);
  });
}

test("the Navigator panel shows a thumbnail, view box, and zoom readout", async ({ page }) => {
  await scene(page);
  await expect(page.locator("[data-mv-nav-thumb]")).toBeVisible();
  await expect(page.locator("[data-mv-nav-viewrect]")).toBeVisible();
  await expect(page.locator("[data-mv-nav-zoom]")).toContainText("100%");
});

test("the zoom readout tracks the store zoom", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setZoom(2, 0, 0));
  await expect(page.locator("[data-mv-nav-zoom]")).toContainText("200%");
});

test("the view box shrinks as zoom increases", async ({ page }) => {
  await scene(page); // pins viewport 200×150 + zoom 1
  const wide = await page.locator("[data-mv-nav-viewrect]").boundingBox();
  await page.evaluate(() => (window as any).__mv.store.setZoom(2, 0, 0));
  await expect.poll(async () => (await page.locator("[data-mv-nav-viewrect]").boundingBox())?.width).toBeLessThan(wide!.width);
});

test("the view box and recentering honor corrected non-square pixels", async ({ page }) => {
  await scene(page);
  const square = await page.locator("[data-mv-nav-viewrect]").boundingBox();
  await page.evaluate(() => (window as any).__mv.store.setPixelAspect(2));
  await expect.poll(async () => (await page.locator("[data-mv-nav-viewrect]").boundingBox())?.width)
    .toBeLessThan(square!.width * 0.6);

  await page.locator("[data-mv-nav-thumb]").click({ position: { x: 150, y: 70 } });
  const correctedPan = await page.evaluate(() => (window as any).__mv.store.state.panX);
  await page.evaluate(() => (window as any).__mv.store.togglePixelAspectCorrection());
  await page.locator("[data-mv-nav-thumb]").click({ position: { x: 150, y: 70 } });
  const squarePan = await page.evaluate(() => (window as any).__mv.store.state.panX);
  expect(Math.abs(correctedPan)).toBeGreaterThan(Math.abs(squarePan));
});

test("clicking the thumbnail recenters the canvas (changes pan)", async ({ page }) => {
  await scene(page); // pins viewport 200×150
  await page.evaluate(() => (window as any).__mv.store.setZoom(2, 0, 0)); // zoom 2, pan reset to 0,0
  // Click near the bottom-right of the thumbnail → centres a far doc point →
  // pushes content up/left (both pans go negative).
  await page.locator("[data-mv-nav-thumb]").click({ position: { x: 196, y: 136 } });
  const pan = await page.evaluate(() => { const s = (window as any).__mv.store.state; return { x: s.panX, y: s.panY }; });
  expect(pan.x).toBeLessThan(0);
  expect(pan.y).toBeLessThan(0);
});
