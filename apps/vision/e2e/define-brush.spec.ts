import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Define Brush Preset (custom tip bitmap) ───────────
// Adobe: Define Brush Preset captures the selection (or layer) as a brush TIP —
// a grayscale alpha bitmap (white→transparent, black→opaque) the brush paints
// with instead of a round disc. Vision captures it in the engine, stores the tip
// bytes in a runtime library (Brushes panel), and pushes the active tip back into
// the engine so the painted footprint matches the bitmap. "Round" reverts to the
// procedural disc.
//   https://helpx.adobe.com/photoshop/using/creating-modifying-brushes.html

// A 32×32 doc whose background holds a 16×16 region (a 4px-wide BLACK vertical bar
// on the LEFT over white). Captures the 16×16 region as the brush tip, then CLEARS
// the background to transparent so a later composite probe reflects only the paint.
async function defineLeftBarTip(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "tip");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    E.select_rect(0, 0, 4, 16, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
    E.select_rect(0, 0, 16, 16, 0); // the capture selection
    mv.engine.sync();
    mv.store.defineBrushPreset();
    // Clear the captured content so the paint-layer composite probe is unobscured.
    E.select_rect(0, 0, 32, 32, 0); E.clear_selection(); E.select_none();
    mv.engine.commit();
  });
}

test("Define Brush Preset adds a tip and paints a non-round footprint; Round reverts", async ({ page }) => {
  await gotoApp(page);
  await defineLeftBarTip(page);

  // The tip surfaces in the Brushes panel (runtime library) and is the active tip.
  await page.locator('[data-tab-id="brushes"]').click();
  await expect(page.locator('[data-mv-brush-tip="Tip 1"]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeBrushTip)).toBe(0);

  // Select the tip and paint RED at (8,8), size 16 (1:1 with the tip) on a fresh
  // transparent layer. The footprint is the bar, NOT a round disc — a black tip
  // pixel in the bbox corner (which a disc can't reach) is opaque, while a white
  // tip pixel mid-height (which a disc WOULD paint) stays transparent.
  const tip = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    const paintId = E.add_layer("paint"); E.set_active_layer(paintId);
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red
    mv.store.setTool("brush");
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1, spacing: 0.16 });
    mv.store.selectBrushTip(0);
    E.stroke_begin(); E.stroke_to(8, 8, 1); E.stroke_end(); E.composite();
    const a = (x: number, y: number) => (E.pick_color(x, y) >>> 0) & 255;
    const rgb = (x: number, y: number) => { const p = E.pick_color(x, y) >>> 0; return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255]; };
    return { paintId, corner: a(1, 1), farCorner: a(1, 14), off: a(10, 8), barRgb: rgb(1, 1) };
  });
  expect(tip.corner).toBeGreaterThan(200);     // black → opaque in the disc corner
  expect(tip.farCorner).toBeGreaterThan(200);  // bar spans the full tip height
  expect(tip.off).toBe(0);                      // white → transparent (≠ disc)
  expect(tip.barRgb[0]).toBeGreaterThan(tip.barRgb[1]); // painted the red foreground
  expect(tip.barRgb[0]).toBeGreaterThan(tip.barRgb[2]);

  // "Round" reverts to the procedural disc: clear the paint layer, repaint with the
  // round brush → the inverse footprint (corner empty, off-bar centre painted).
  const round = await page.evaluate((paintId: number) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.set_active_layer(paintId);
    E.select_rect(0, 0, 32, 32, 0); E.clear_selection(); E.select_none();
    mv.store.selectRoundBrush();
    E.stroke_begin(); E.stroke_to(8, 8, 1); E.stroke_end(); E.composite();
    const a = (x: number, y: number) => (E.pick_color(x, y) >>> 0) & 255;
    return { corner: a(1, 1), off: a(10, 8) };
  }, tip.paintId);
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeBrushTip)).toBe(-1);
  expect(round.corner).toBe(0);            // disc leaves the corner clear
  expect(round.off).toBeGreaterThan(200);  // disc paints the off-bar centre
});

test("a brush tip removes from the panel and reverts to round when it was active", async ({ page }) => {
  await gotoApp(page);
  await defineLeftBarTip(page);
  await page.locator('[data-tab-id="brushes"]').click();
  await expect(page.locator('[data-mv-brush-tip="Tip 1"]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeBrushTip)).toBe(0);
  // Alt-click removes the active tip → library empties and the brush reverts to round.
  await page.locator('[data-mv-brush-tip="Tip 1"]').click({ modifiers: ["Alt"] });
  await expect(page.locator('[data-mv-brush-tip="Tip 1"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeBrushTip)).toBe(-1);
  expect(await page.evaluate(() => (window as any).__mv.store.state.brushTips.length)).toBe(0);
});
