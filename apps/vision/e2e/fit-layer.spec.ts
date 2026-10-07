import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── View ▸ Fit Layer(s) on Screen ──────────────────────────────────
// Adobe: zooms/pans so the active layer's content bounding box fills the
// viewport (the layer-scoped counterpart of Fit on Screen). Vision reads the
// active layer's opaque-content bbox from the engine (active_layer_bbox) and
// applies the pure fit-to-rect math in src/state/zoomPresets.ts (fitRectView).
//   https://helpx.adobe.com/photoshop/using/zooming-viewing-image.html

// A doc whose active layer holds content only in a sub-rectangle, so its bbox
// is genuinely smaller than the canvas. Returns that content rect.
async function spotLayer(page: Page) {
  await gotoApp(page);
  const rect = { x: 400, y: 300, w: 120, h: 60 };
  await page.evaluate(({ x, y, w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(600, 400, "fitlayer"); // switches mv.engine.engine to the new doc
    mv.store.addLayer(); // transparent, active — via the store so store↔engine agree
    const e = mv.engine.engine; // capture AFTER the doc switch (else it's the old doc)
    e.select_rect(x, y, w, h, 0);
    e.fill_selection(255, 0, 0, 255); // opaque red in one corner
    e.select_none();
    mv.engine.commit();
  }, rect);
  // Wait for the viewport to be measured (fitLayer needs a non-zero viewport).
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.viewport.w)).toBeGreaterThan(0);
  return rect;
}

const view = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { zoom: s.zoom, panX: s.panX, panY: s.panY, vpW: s.viewport.w, vpH: s.viewport.h };
  });
const bbox = (page: Page) =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.active_layer_bbox() as Int32Array));

test("centres the active layer's content in the viewport", async ({ page }) => {
  const r = await spotLayer(page);
  // The engine sees the content bbox we painted (inclusive coords).
  expect(await bbox(page)).toEqual([r.x, r.y, r.x + r.w - 1, r.y + r.h - 1]);

  await page.evaluate(() => (window as any).__mv.store.fitLayer());
  const v = await view(page);
  // Content centre (canvas space) lands at the viewport centre.
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  expect(Math.abs(v.panX + cx * v.zoom - v.vpW / 2)).toBeLessThan(1);
  expect(Math.abs(v.panY + cy * v.zoom - v.vpH / 2)).toBeLessThan(1);
});

test("zooms in tighter on a small layer than fitting the whole document", async ({ page }) => {
  await spotLayer(page);
  await page.evaluate(() => (window as any).__mv.store.fitLayer());
  const v = await view(page);
  // Whole-doc fit (same 0.9 margin, clamped to 8): the 120×60 content sits well
  // inside the 600×400 canvas, so fitting it zooms strictly further in.
  const docFit = Math.min(8, Math.min(v.vpW / 600, v.vpH / 400) * 0.9);
  expect(v.zoom).toBeGreaterThan(docFit);
});

test("an empty (transparent) layer falls back to whole-doc fit without error (soak)", async ({ page }) => {
  await spotLayer(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.addLayer(); // transparent, active, no content
    mv.engine.commit();
  });
  expect(await bbox(page)).toEqual([]); // no opaque content → empty bbox
  // Repeated fits on the empty layer stay well-formed (no NaN/throw).
  for (let i = 0; i < 3; i++) await page.evaluate(() => (window as any).__mv.store.fitLayer());
  const v = await view(page);
  expect(v.zoom).toBeGreaterThan(0);
  expect(Number.isFinite(v.panX) && Number.isFinite(v.panY)).toBe(true);
});
