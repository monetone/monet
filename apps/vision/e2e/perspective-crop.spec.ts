import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// ── Photoshop Perspective Crop ─────────────────────────────────────
// Adobe: draw a quad over a skewed rectangular subject; the tool rectifies it
// (deskews) into a new, fronto-parallel image. Vision wires per-corner fractions
// + an output size to the engine op perspective_crop (the inverse of
// perspective_transform), which resizes the canvas and resamples every layer.
//   https://helpx.adobe.com/photoshop/using/perspective-crop-tool.html

type Corner = { x: number; y: number };
const crop = (page: Page, corners: Corner[], outW: number, outH: number) =>
  page.evaluate(({ c, w, h }) => (window as any).__mv.perspectiveCrop(c, w, h), { c: corners, w: outW, h: outH });
const dims = (page: Page) => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
// pick_color packs 0xRRGGBBAA.
const px = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => { const v = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0; return { r: (v >>> 24) & 255, g: (v >>> 16) & 255, b: (v >>> 8) & 255 }; }, { x, y });

const FULL: Corner[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

/** 160×120 doc: left half red, right half blue. */
async function halves(page: Page) {
  await gotoApp(page);
  await newScene(page, 160, 120);
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    E.select_rect(0, 0, 160, 120, 0); E.fill_selection(255, 0, 0, 255); E.select_none();
    E.select_rect(80, 0, 80, 120, 0); E.fill_selection(0, 0, 255, 255); E.select_none();
    mv.engine.commit();
  });
}

test("a full-rect quad resizes to the output rectangle, preserving the layout", async ({ page }) => {
  await halves(page);
  await crop(page, FULL, 80, 60); // identity quad → pure downscale
  expect(await dims(page)).toEqual({ w: 80, h: 60 });
  expect((await px(page, 8, 30)).r).toBeGreaterThan(200); // left still red
  expect((await px(page, 72, 30)).b).toBeGreaterThan(200); // right still blue
});

test("rectifies a quad from one region into a new canvas, excluding the rest", async ({ page }) => {
  await halves(page);
  // A quad living entirely inside the blue right half.
  await crop(page, [{ x: 0.6, y: 0.1 }, { x: 0.95, y: 0.1 }, { x: 0.95, y: 0.9 }, { x: 0.6, y: 0.9 }], 100, 100);
  expect(await dims(page)).toEqual({ w: 100, h: 100 });
  for (const [x, y] of [[2, 2], [50, 50], [97, 97]]) {
    const c = await px(page, x, y);
    expect(c.b).toBeGreaterThan(200); // rectified region is all blue…
    expect(c.r).toBeLessThan(40); // …with the red half excluded
  }
});

test("successive crops each resize the canvas to their output (soak)", async ({ page }) => {
  await halves(page);
  for (const [w, h] of [[120, 90], [64, 64], [200, 100]] as const) {
    await crop(page, FULL, w, h);
    expect(await dims(page)).toEqual({ w, h });
  }
});
