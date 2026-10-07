import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Crop tool ▸ aspect Ratio presets ─────────────────────
// Adobe: the Crop tool's options bar Ratio control locks the crop box to a
// width:height (1:1, 16:9, …). Vision adds an aspect dropdown; fitRectToAspect
// (src/state/cropAspect.ts) fits the largest ratio rect inside the drag box.
//   https://helpx.adobe.com/photoshop/using/crop-straighten-photos.html

const DOC = 200; // square document so the doc→client mapper is uniform

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate((n) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(n, n, "crop");
    mv.engine.commit();
    mv.store.setTool("crop");
    mv.store.fit();
  }, DOC);
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOC, cy: (d: number) => box.y + d * box.h / DOC };
}

const dims = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));

const drag = async (page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, ax: number, ay: number, bx: number, by: number) => {
  await page.mouse.move(m.cx(ax), m.cy(ay));
  await page.mouse.down();
  await page.mouse.move(m.cx(bx), m.cy(by), { steps: 8 });
  await page.mouse.up();
};

test("a 1:1 crop yields a square document", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ cropAspect: "1:1" }));
  await drag(page, m, 20, 20, 180, 100); // 160×80 box → 80×80 square
  const d = await dims(page);
  expect(d.w).toBe(d.h);
  expect(Math.abs(d.w - 80)).toBeLessThan(3);
});

test("a 16:9 crop yields a ~16:9 document", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ cropAspect: "16:9" }));
  await drag(page, m, 0, 0, 200, 60); // 200×60 box → height-limited 107×60
  const d = await dims(page);
  expect(d.w / d.h).toBeCloseTo(16 / 9, 1);
  expect(Math.abs(d.h - 60)).toBeLessThan(3);
});

test("a free crop yields the exact drag dimensions", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ cropAspect: "free" }));
  await drag(page, m, 10, 10, 110, 60); // 100×50 box → 100×50 (unconstrained)
  const d = await dims(page);
  expect(Math.abs(d.w - 100)).toBeLessThan(3);
  expect(Math.abs(d.h - 50)).toBeLessThan(3);
});

test("the options-bar Ratio dropdown updates cropAspect", async ({ page }) => {
  await scene(page);
  expect(await page.evaluate(() => (window as any).__mv.store.state.cropAspect)).toBe("free");
  await chooseOption(page.locator("#mv-crop-aspect"), "16:9");
  expect(await page.evaluate(() => (window as any).__mv.store.state.cropAspect)).toBe("16:9");
});
