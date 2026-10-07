import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Marquee "Style" (Normal / Fixed Ratio / Fixed Size) ──
// Adobe: the Rectangular/Elliptical Marquee options bar has a Style menu. Fixed
// Ratio locks the width:height aspect of the drag; Fixed Size makes a click create
// an exact W×H selection. Vision adds the Style control + W/H fields and the pure
// geometry in src/state/marqueeStyle.ts.
//   https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html

const DOCW = 260;
const DOCH = 260;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "marquee-style");
    mv.engine.commit();
    mv.store.setTool("marquee");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

const bounds = (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);
const setOpts = (page: Page, o: Record<string, unknown>): Promise<void> =>
  page.evaluate((opts) => (window as any).__mv.store.setOptions(opts), o);
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2);
  await page.mouse.move(x1, y1);
  await page.mouse.up();
}

test("the Style control reveals bounded W/H fields", async ({ page }) => {
  await scene(page);
  await page.getByText("Fixed Size", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.marqueeStyle)).toBe("size");
  await expect(page.locator("#mv-marquee-w")).toBeVisible();
  await expect(page.locator("#mv-marquee-h")).toBeVisible();
  await page.locator("#mv-marquee-w").fill(String(2 ** 31));
  expect(await page.evaluate(() => (window as any).__mv.store.state.marqueeFixedW)).toBe(10_000);
});

test("Fixed Size click creates an exact W×H selection", async ({ page }) => {
  const m = await scene(page);
  await setOpts(page, { marqueeStyle: "size", marqueeFixedW: 120, marqueeFixedH: 80 });
  await page.mouse.click(m.cx(60), m.cy(50));
  const b = await bounds(page); // [x, y, w, h]
  expect(b[2]).toBe(120);
  expect(b[3]).toBe(80);
  expect(Math.abs(b[0] - 60)).toBeLessThanOrEqual(3);
  expect(Math.abs(b[1] - 50)).toBeLessThanOrEqual(3);
});

test("Fixed Size keeps its geometry and clips rectangle and ellipse selections at the canvas edge", async ({ page }) => {
  const m = await scene(page);
  await setOpts(page, {
    marqueeStyle: "size", marqueeFixedW: 80, marqueeFixedH: 60,
    snapEnabled: false, selectionFeather: 0, antiAlias: false,
  });

  for (const [tool, kind] of [["marquee", "rect"], ["ellipse", "ellipse"]] as const) {
    await page.evaluate((nextTool) => (window as any).__mv.store.setTool(nextTool), tool);
    await page.mouse.move(m.cx(220), m.cy(230));
    await page.mouse.down();
    await page.mouse.move(m.cx(221), m.cy(231));

    const shape = page.locator(`[data-mv-preview="${kind}"]`);
    await expect(shape).toBeVisible();
    const preview = await shape.evaluate((node) => {
      const graphic = node as SVGGraphicsElement;
      const box = graphic.getBBox();
      return { x: box.x, y: box.y, w: box.width, h: box.height, overflow: graphic.ownerSVGElement?.style.overflow };
    });
    expect(Math.abs(preview.x - 220)).toBeLessThanOrEqual(2);
    expect(Math.abs(preview.y - 230)).toBeLessThanOrEqual(2);
    expect(preview.w).toBe(80);
    expect(preview.h).toBe(60);
    expect(preview.overflow).toBe("hidden");

    await page.mouse.up();
    const b = await bounds(page);
    expect(Math.abs(b[0] - 220)).toBeLessThanOrEqual(2);
    expect(Math.abs(b[1] - 230)).toBeLessThanOrEqual(2);
    expect(Math.abs(b[2] - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(b[3] - 30)).toBeLessThanOrEqual(2);
  }
});

test("Fixed Ratio 1:1 makes a non-square drag into a square selection", async ({ page }) => {
  const m = await scene(page);
  await setOpts(page, { marqueeStyle: "ratio", marqueeFixedW: 1, marqueeFixedH: 1 });
  await drag(page, m.cx(20), m.cy(20), m.cx(180), m.cy(80)); // 160 × 60 drag
  const b = await bounds(page);
  expect(Math.abs(b[2] - b[3])).toBeLessThanOrEqual(3); // square
  expect(b[3]).toBeGreaterThan(120); // height grew well past the 60px drag
});

test("Fixed Ratio 2:1 keeps the selection twice as wide as tall", async ({ page }) => {
  const m = await scene(page);
  await setOpts(page, { marqueeStyle: "ratio", marqueeFixedW: 2, marqueeFixedH: 1 });
  await drag(page, m.cx(20), m.cy(20), m.cx(180), m.cy(120)); // 160 × 100 drag
  const b = await bounds(page);
  expect(Math.abs(b[2] - b[3] * 2)).toBeLessThanOrEqual(4);
});

test("Normal style leaves the drag unconstrained", async ({ page }) => {
  const m = await scene(page);
  await setOpts(page, { marqueeStyle: "normal" });
  await drag(page, m.cx(20), m.cy(20), m.cx(180), m.cy(80)); // 160 × 60 drag
  const b = await bounds(page);
  expect(Math.abs(b[2] - 160)).toBeLessThanOrEqual(4);
  expect(Math.abs(b[3] - 60)).toBeLessThanOrEqual(4); // height stays ~60, not squared up
});
