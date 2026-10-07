import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page, 240, 180); });

test("resize image changes dimensions", async ({ page }) => {
  const d = await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.xform.resizeImage(120, 90); return { w: E().width(), h: E().height() }; });
  expect(d).toEqual({ w: 120, h: 90 });
});

test("resize canvas changes dimensions", async ({ page }) => {
  const d = await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.xform.resizeCanvas(300, 240, 30, 30); return { w: E().width(), h: E().height() }; });
  expect(d).toEqual({ w: 300, h: 240 });
});

test("crop changes dimensions", async ({ page }) => {
  const d = await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.xform.crop(40, 30, 120, 90); return { w: E().width(), h: E().height() }; });
  expect(d).toEqual({ w: 120, h: 90 });
});

test("rotate 90 swaps dimensions", async ({ page }) => {
  const d = await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.xform.rotate90(true); return { w: E().width(), h: E().height() }; });
  expect(d).toEqual({ w: 180, h: 240 });
});

test("flip horizontal and vertical change the composite", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.xform.flipH());
  const flipped = await composite(page);
  expect(flipped.chk).not.toBe(before.chk);
  await page.evaluate(() => (window as any).__mv.xform.flipV());
  const both = await composite(page);
  expect(both.chk).not.toBe(flipped.chk);
});

test("free transform (scale/rotate/translate) changes the composite", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.xform.transformLayer(0.8, 0.8, 15, 10, 5));
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("perspective transform changes the composite", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.perspectiveTransform());
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("puppet warp commit moves the dragged pin and cancel leaves the composite", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.puppetWarp();
    mv.placePuppetPin(60, 45);
    mv.movePuppetPin(80, 50);
    mv.cancelPuppetWarp();
  });
  const afterCancel = await composite(page);
  expect(afterCancel.chk).toBe(before.chk);
  const colors = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    const paint = (x: number, y: number, r: number, g: number, b: number) => {
      E().select_rect(x, y, 1, 1, 0);
      E().fill_selection(r, g, b, 255);
    };
    // 240×180, 4×4 grid. Vertex (1,1) rests at (60, 45); vertex (3,1) at (180, 45).
    paint(60, 45, 255, 0, 0);
    paint(59, 45, 0, 255, 0);
    paint(180, 45, 0, 0, 255);
    E().select_none();
    mv.engine.commit();
    mv.puppetWarp();
    mv.placePuppetPin(180, 45);
    mv.placePuppetPin(60, 45);
    mv.movePuppetPin(61, 45);
    mv.commitPuppetWarp();
    const pick = (x: number, y: number) => {
      const c = E().pick_color(x, y) >>> 0;
      return { r: (c >>> 24) & 255, g: (c >>> 16) & 255, b: (c >>> 8) & 255 };
    };
    return { dragged: pick(60, 45), fixed: pick(180, 45) };
  });
  expect(colors.dragged.g).toBeGreaterThan(200);
  expect(colors.fixed.b).toBeGreaterThan(200);
});

test("spherize and twirl distort filters change the composite", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.distort.spherize(0.6));
  const sph = await composite(page);
  expect(sph.chk).not.toBe(before.chk);
  await page.evaluate(() => (window as any).__mv.distort.twirl(60));
  const tw = await composite(page);
  expect(tw.chk).not.toBe(sph.chk);
});
