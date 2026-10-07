import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Line tool ────────────────────────────────────────────
// Adobe: the Line tool draws a straight line from press to release; Weight sets
// thickness, Shift constrains to 45°. Vision adds a "line" Shape kind drawn from
// the drag endpoints and filled as a weight-thick quad via select_polygon +
// fill_selection (src/state/lineShape.ts builds the quad).
//   https://helpx.adobe.com/photoshop/using/drawing-shapes.html

const DOCW = 200;
const DOCH = 140;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "line");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); // white bg
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red foreground
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "line" });
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(async ({ x, y }) => {
    const mv = (window as any).__mv;
    const png = mv.engine.engine.export_png();
    const blob = new Blob([png], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img: HTMLImageElement = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const cx = c.getContext("2d")!; cx.drawImage(img, 0, 0);
    const d = cx.getImageData(x, y, 1, 1).data;
    URL.revokeObjectURL(url);
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[1] < 80 && p[2] < 80;
const isWhite = (p: number[]) => p[0] > 230 && p[1] > 230 && p[2] > 230;

const drawHLine = async (page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, yDoc: number) => {
  await page.mouse.move(m.cx(10), m.cy(yDoc));
  await page.mouse.down();
  await page.mouse.move(m.cx(190), m.cy(yDoc), { steps: 8 });
  await page.mouse.up();
};

test("draws a horizontal line of the given weight", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ lineWeight: 6 }));
  await drawHLine(page, m, 70);
  expect(isRed(await pixelAt(page, 100, 70))).toBe(true);  // on the line
  expect(isWhite(await pixelAt(page, 100, 40))).toBe(true); // well above
  expect(isWhite(await pixelAt(page, 100, 100))).toBe(true); // well below
});

test("a thicker weight fills a taller band", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ lineWeight: 24 }));
  await drawHLine(page, m, 70);
  expect(isRed(await pixelAt(page, 100, 70))).toBe(true);
  expect(isRed(await pixelAt(page, 100, 80))).toBe(true);  // within the 24px band (58..82)
  expect(isWhite(await pixelAt(page, 100, 110))).toBe(true); // outside it
});

test("the options bar Weight updates and clamps to >= 1", async ({ page }) => {
  await scene(page);
  await page.fill("#mv-line-weight", "8");
  expect(await page.evaluate(() => (window as any).__mv.store.state.lineWeight)).toBe(8);
  await page.fill("#mv-line-weight", "0"); // below the floor
  expect(await page.evaluate(() => (window as any).__mv.store.state.lineWeight)).toBe(1);
});

test("the drag preview tracks the true endpoints (no bbox mirroring)", async ({ page }) => {
  const m = await scene(page);
  // up-right drag: start below-left, end above-right — a bbox preview would mirror it
  await page.mouse.move(m.cx(40), m.cy(110));
  await page.mouse.down();
  await page.mouse.move(m.cx(160), m.cy(30), { steps: 6 });
  const a = await page.locator('[data-mv-preview="line"]').evaluate((el) => ({
    x1: +el.getAttribute("x1")!, y1: +el.getAttribute("y1")!, x2: +el.getAttribute("x2")!, y2: +el.getAttribute("y2")!,
  }));
  await page.mouse.up();
  expect(Math.abs(a.x1 - 40)).toBeLessThan(3); expect(Math.abs(a.y1 - 110)).toBeLessThan(3);  // start
  expect(Math.abs(a.x2 - 160)).toBeLessThan(3); expect(Math.abs(a.y2 - 30)).toBeLessThan(3);  // end (not mirrored)
});

test("Shift snaps the drag preview to a 45° axis", async ({ page }) => {
  const m = await scene(page);
  // near-horizontal drag with Shift → should snap to horizontal (end y ≈ start y)
  await page.mouse.move(m.cx(40), m.cy(40));
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(m.cx(160), m.cy(52), { steps: 6 });
  const a = await page.locator('[data-mv-preview="line"]').evaluate((el) => ({
    y1: +el.getAttribute("y1")!, y2: +el.getAttribute("y2")!,
  }));
  await page.keyboard.up("Shift");
  await page.mouse.up();
  expect(Math.abs(a.y1 - 40)).toBeLessThan(4);
  expect(Math.abs(a.y2 - 40)).toBeLessThan(4); // snapped flat, not following the 52
});

test("the Line options segment selects the line shape kind", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("shape"));
  await page.getByText("Line", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.shapeKind)).toBe("line");
});
