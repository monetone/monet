import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Move tool options bar ────────────────────────────────
// Adobe: with the Move tool active, the options bar shows Show Transform Controls
// (the active layer's Free-Transform frame) plus Align + Distribute buttons.
// Vision adds that bar: a new transform-controls overlay (pure geometry in
// src/state/transformControls.ts) + the existing alignLayer/distributeLayers.
//   https://helpx.adobe.com/photoshop/using/aligning-distributing-layers.html

/** Active-layer content bounds [x,y,w,h]. */
const bounds = (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.active_layer_bounds()));

/** Fresh 200×200 doc, Move tool active, a 30×30 patch painted in the top-left. */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "move");
    const E = mv.engine.engine; // after newDocument: the new doc's active engine
    mv.store.addLayer(); // transparent layer, becomes active
    E.select_rect(10, 10, 30, 30, 0); E.fill_selection(20, 120, 230, 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool("move");
  });
}

test("the Move tool options bar shows Show Transform Controls + Align/Distribute", async ({ page }) => {
  await scene(page);
  await expect(page.getByRole("checkbox", { name: "Show Transform Controls" })).toBeVisible();
  await expect(page.locator("#mv-align-left")).toBeVisible();
  await expect(page.locator("#mv-align-right")).toBeVisible();
  await expect(page.locator("#mv-dist-top")).toBeVisible();
});

test("Show Transform Controls toggles the bounding-box overlay", async ({ page }) => {
  await scene(page);
  await expect(page.locator("[data-mv-xform-box]")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show Transform Controls" }).click();
  await expect(page.locator("[data-mv-xform-box]")).toHaveCount(1);
  await expect(page.locator("[data-mv-xform-handle]")).toHaveCount(8);
  await page.getByRole("checkbox", { name: "Show Transform Controls" }).click();
  await expect(page.locator("[data-mv-xform-box]")).toHaveCount(0);
});

test("Align Right / Align Bottom move the active layer to the canvas edges", async ({ page }) => {
  await scene(page);
  // precondition: the patch sits in the top-left
  expect(await bounds(page)).toEqual([10, 10, 30, 30]);
  await page.locator("#mv-align-right").click();
  const r = await bounds(page);
  expect(r[0] + r[2]).toBe(200); // right edge at canvas width
  await page.locator("#mv-align-bottom").click();
  const b = await bounds(page);
  expect(b[1] + b[3]).toBe(200); // bottom edge at canvas height
});

// Three layers with content at different x; multi-selected. Align now snaps them
// to the GROUP's extreme edge (Photoshop relative align), not the canvas.
async function threeLayers(page: Page): Promise<{ a: number; b: number; c: number }> {
  await gotoApp(page);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 100, "align");
    const E = mv.engine.engine;
    const mk = (x: number, r: number, g: number, b: number) => {
      mv.store.addLayer();
      const id = mv.store.state.activeLayerId;
      E.select_rect(x, 20, 20, 20, 0); E.fill_selection(r, g, b, 255); E.select_none();
      return id;
    };
    const a = mk(10, 220, 0, 0), b = mk(50, 0, 220, 0), c = mk(120, 0, 0, 220);
    mv.engine.commit();
    mv.store.selectLayer(a);
    mv.store.toggleLayerInSelection(b);
    mv.store.toggleLayerInSelection(c);
    mv.store.setTool("move");
    return { a, b, c };
  });
  return ids;
}

const leftOf = (page: Page, id: number): Promise<number> =>
  page.evaluate((id) => { const E = (window as any).__mv.engine.engine; E.set_active_layer(id); return E.active_layer_bounds()[0]; }, id);
const rightOf = (page: Page, id: number): Promise<number> =>
  page.evaluate((id) => { const E = (window as any).__mv.engine.engine; E.set_active_layer(id); const b = E.active_layer_bounds(); return b[0] + b[2]; }, id);

test("Align Left snaps all selected layers to the group's left edge (relative, not canvas)", async ({ page }) => {
  const { a, b, c } = await threeLayers(page);
  await page.locator("#mv-align-left").click();
  // The group's leftmost edge is 10 (layer a) — NOT the canvas edge 0.
  expect([await leftOf(page, a), await leftOf(page, b), await leftOf(page, c)]).toEqual([10, 10, 10]);
});

test("Align Right snaps all selected layers to the group's right edge", async ({ page }) => {
  const { a, b, c } = await threeLayers(page);
  await page.locator("#mv-align-right").click();
  // The group's rightmost edge is 140 (layer c at x=120, width 20).
  expect([await rightOf(page, a), await rightOf(page, b), await rightOf(page, c)]).toEqual([140, 140, 140]);
});

// Three UNEQUAL-width layers, multi-selected. "Distribute spacing" equalises the
// empty gaps between them (accounting for size) — distinct from distributing
// centres/edges — and keeps the outer edges fixed.
const span = (page: Page, id: number): Promise<[number, number]> =>
  page.evaluate((id) => { const E = (window as any).__mv.engine.engine; E.set_active_layer(id); const b = E.active_layer_bounds(); return [b[0], b[0] + b[2]]; }, id);

test("the Move tool options bar shows the Distribute spacing buttons", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-dist-hspace")).toBeVisible();
  await expect(page.locator("#mv-dist-vspace")).toBeVisible();
});

test("Distribute horizontal spacing equalises the gaps between layers", async ({ page }) => {
  await gotoApp(page);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 100, "space");
    const E = mv.engine.engine;
    const mk = (x: number, w: number) => {
      mv.store.addLayer();
      const id = mv.store.state.activeLayerId;
      E.select_rect(x, 20, w, 20, 0); E.fill_selection(220, 0, 0, 255); E.select_none();
      return id;
    };
    const a = mk(0, 10), b = mk(40, 60), c = mk(150, 10); // unequal widths
    mv.engine.commit();
    mv.store.selectLayer(a);
    mv.store.toggleLayerInSelection(b);
    mv.store.toggleLayerInSelection(c);
    mv.store.setTool("move");
    return { a, b, c };
  });
  await page.locator("#mv-dist-hspace").click();
  const [sa, sb, sc] = [await span(page, ids.a), await span(page, ids.b), await span(page, ids.c)];
  const gapAB = sb[0] - sa[1]; // left_b − right_a
  const gapBC = sc[0] - sb[1];
  expect(Math.abs(gapAB - gapBC)).toBeLessThanOrEqual(2); // gaps equalised
  expect(sa[0]).toBe(0);   // leftmost edge fixed
  expect(sc[1]).toBe(160); // rightmost edge fixed
});
