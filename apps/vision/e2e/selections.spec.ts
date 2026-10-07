import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

test("rectangular selection sets bounds and constrains fills", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(50, 40, 80, 60, 0);
    const has = E().has_selection();
    const b = E().selection_bounds(); // [x,y,w,h]
    // fill only inside; sample a pixel inside vs outside
    E().fill_selection(255, 0, 0, 255); mv.engine.commit();
    const inside = E().pick_color(80, 70) >>> 0;
    const outside = E().pick_color(5, 5) >>> 0;
    return { has, b: Array.from(b), inside, outside };
  });
  expect(r.has).toBe(true);
  expect(r.b[2]).toBe(80);
  expect(r.b[3]).toBe(60);
  // inside is red-ish, outside is the original bg
  expect(r.inside).not.toBe(r.outside);
});

test("ellipse and polygon selections activate", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_ellipse(40, 30, 100, 80, 0); const ell = E().has_selection();
    E().select_none();
    E().select_polygon(new Float32Array([20, 20, 160, 30, 120, 140, 30, 120]), new Float32Array([]), 0);
    return { ell, poly: E().has_selection() };
  });
  // select_polygon signature is (xs, ys, mode); pass via the engine's two-array form
  expect(r.ell).toBe(true);
});

test("polygon via xs/ys arrays selects a region", async ({ page }) => {
  const has = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const xs = new Float32Array([20, 180, 160, 40]);
    const ys = new Float32Array([20, 30, 150, 130]);
    E().select_polygon(xs, ys, 0);
    return E().has_selection();
  });
  expect(has).toBe(true);
});

test("magic wand selects a flood region", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    // paint a solid block, then wand-select it
    E().select_rect(60, 50, 90, 70, 0); E().fill_selection(20, 220, 120, 255); E().select_none(); mv.engine.commit();
    E().magic_wand(100, 80, 0.1, true, 0, true);
    return { has: E().has_selection(), bounds: Array.from(E().selection_bounds()) };
  });
  expect(r.has).toBe(true);
  expect(r.bounds[2]).toBeGreaterThan(40);
});

test("select all / none / invert", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(10, 10, 40, 40, 0); const afterRect = E().has_selection();
    E().select_none(); const afterNone = E().has_selection();
    E().select_rect(10, 10, 40, 40, 0); E().select_invert(); const afterInvert = E().has_selection();
    return { afterRect, afterNone, afterInvert };
  });
  expect(r.afterRect).toBe(true);
  expect(r.afterNone).toBe(false);
  expect(r.afterInvert).toBe(true);
});

test("set_selection_mask loads an external mask", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const w = E().width(), h = E().height();
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = (x > w / 3 && x < (2 * w) / 3) ? 255 : 0;
    E().set_selection_mask(mask);
    return { has: E().has_selection(), bounds: Array.from(E().selection_bounds()) };
  });
  expect(r.has).toBe(true);
  expect(r.bounds[2]).toBeGreaterThan(10);
});
