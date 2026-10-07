import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Eyedropper "Sample Size" ─────────────────────────────
// Adobe spec (helpx / community): the Eyedropper options bar has a Sample Size
// menu — Point Sample (the single pointed pixel, the default), 3×3 Average, 5×5
// Average, 11×11 Average … — that averages an NxN square around the click before
// setting the foreground colour (useful over noisy/grainy images). The app only
// did Point Sample. This adds the averaged sizes.
//
//   https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html

const DOCW = 200;
const DOCH = 140;

const picked = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.picked as { r: number; g: number; b: number; a: number });

// Doc split left-black | right-white, with the eyedropper armed. Returns doc→client.
async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "drop");
    const E = mv.engine.engine; // AFTER newDocument
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("dropper");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

// ── Integration: pick_color_avg through the engine FFI ─────────────
test("pick_color_avg is Point Sample at radius 0 and averages a window otherwise", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "d");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 10, 20, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(10, 0, 10, 20, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); E.composite();
    const red = (x: number, y: number, rad: number) => ((E.pick_color_avg(x, y, rad) >>> 0) >>> 24) & 255;
    return { pointBlack: red(5, 10, 0), pointWhite: red(15, 10, 0), avg5: red(10, 10, 2) };
  });
  expect(r.pointBlack).toBe(0);    // Point Sample = exact pixel
  expect(r.pointWhite).toBe(255);
  expect(r.avg5).toBeGreaterThan(130); // 5×5 across the boundary → grey
  expect(r.avg5).toBeLessThan(175);
});

// ── Mouse: clicking the eyedropper honours Sample Size ─────────────
test("eyedropper Point Sample picks an exact pixel; 11×11 averages the boundary", async ({ page }) => {
  const m = await setup(page);

  await page.evaluate(() => (window as any).__mv.store.setOptions({ sampleSize: 1 }));
  await page.mouse.click(m.cx(100), m.cy(70)); // at the black|white boundary
  const pt = await picked(page);
  expect(pt.r < 40 || pt.r > 220).toBe(true); // an extreme (black or white) pixel

  await page.evaluate(() => (window as any).__mv.store.setOptions({ sampleSize: 11 }));
  await page.mouse.click(m.cx(100), m.cy(70)); // same spot, 11×11 average
  const av = await picked(page);
  expect(av.r).toBeGreaterThan(90);  // grey: the window straddles black and white
  expect(av.r).toBeLessThan(180);
});

// ── UI: the Sample Size control ────────────────────────────────────
test("the eyedropper options bar exposes Sample Size and it drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("dropper"));
  await expect(page.getByRole("radio", { name: "Point", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.sampleSize)).toBe(1); // PS default

  await page.getByRole("radio", { name: /11.11/ }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.sampleSize)).toBe(11);
  await page.getByRole("radio", { name: "Point", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.sampleSize)).toBe(1);
});
