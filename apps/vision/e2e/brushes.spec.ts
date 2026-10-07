import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

// stroke helper executed in-page
const STROKE = `(E, mode, erase, clone) => {
  if (clone) E().set_clone(true, 40, 30); else E().set_clone(false, 0, 0);
  E().set_brush(28, 0.9, 1, 1, 0.2, 255, 40, 40, 255, !!erase);
  E().set_brush_mode(mode);
  E().stroke_begin();
  for (let x = 20; x < 230; x += 6) E().stroke_to(x, 96, 1);
  E().stroke_end();
}`;

async function strokeAndDiff(page: Page, mode: number, erase = false, clone = false) {
  const before = await composite(page);
  await page.evaluate(({ src, mode, erase, clone }) => {
    const mv = (window as any).__mv; const E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func
    new Function("E", "mode", "erase", "clone", "(" + src + ")(E, mode, erase, clone)")(E, mode, erase, clone);
    mv.engine.commit();
  }, { src: STROKE, mode, erase, clone });
  const after = await composite(page);
  return { before, after };
}

test("paint brush strokes onto the canvas", async ({ page }) => {
  const { before, after } = await strokeAndDiff(page, 0);
  expect(after.chk).not.toBe(before.chk);
});

test("eraser reduces coverage (alpha)", async ({ page }) => {
  // erase on the (opaque) background lowers alpha somewhere
  const before = await composite(page);
  await page.evaluate(({ src }) => {
    const mv = (window as any).__mv; const E = () => mv.engine.engine;
    // eslint-disable-next-line no-new-func -- test ships a function across page.evaluate as a string
    new Function("E", "mode", "erase", "clone", "(" + src + ")(E, mode, erase, clone)")(E, 1, true, false);
    mv.engine.commit();
  }, { src: STROKE });
  const after = await composite(page);
  expect(after.alphaMean).toBeLessThan(before.alphaMean);
});

test("dodge lightens and burn darkens", async ({ page }) => {
  const dodge = await strokeAndDiff(page, 2);
  expect(dodge.after.mean).toBeGreaterThan(dodge.before.mean);
  await newScene(page);
  const burn = await strokeAndDiff(page, 3);
  expect(burn.after.mean).toBeLessThan(burn.before.mean);
});

test("smudge changes the composite", async ({ page }) => {
  const { before, after } = await strokeAndDiff(page, 4);
  expect(after.chk).not.toBe(before.chk);
});

test("healing brush changes the composite", async ({ page }) => {
  const { before, after } = await strokeAndDiff(page, 5);
  expect(after.chk).not.toBe(before.chk);
});

test("clone stamp copies from an offset", async ({ page }) => {
  const { before, after } = await strokeAndDiff(page, 0, false, true);
  expect(after.chk).not.toBe(before.chk);
});

test("bucket fill floods a region", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; E().bucket_fill(128, 96, 250, 120, 30, 255, 0.5, false, false, 0, 1); mv.engine.commit(); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("gradient fill paints a gradient", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const stops = new Float32Array([0, 0, 0, 0, 255, 1, 255, 255, 255, 255]); // black->white
    E().gradient_fill(0, 0, E().width(), E().height(), 0, false, stops, false, true, 0, 0, 1);
    mv.engine.commit();
  });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("fill selection fills with a color", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; E().select_rect(30, 30, 120, 90, 0); E().fill_selection(255, 0, 255, 255); E().select_none(); mv.engine.commit(); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});
