import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Rounded Rectangle ────────────────────────────────────
// Adobe: draws a rectangle with rounded corners; the corner Radius is set in the
// options bar. Vision adds a "roundrect" Shape kind whose outline (4 corner arcs
// + straight sides) is built in src/state/roundRectShape.ts and filled via
// select_polygon + fill_selection.
//   https://helpx.adobe.com/photoshop/using/drawing-shapes.html

const DOCW = 200;
const DOCH = 140;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "rrect");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); // white bg
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red foreground
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "roundrect" });
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

const drawFull = async (page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) => {
  await page.mouse.move(m.cx(0), m.cy(0));
  await page.mouse.down();
  await page.mouse.move(m.cx(200), m.cy(140), { steps: 8 });
  await page.mouse.up();
};

test("a large radius rounds the corners (corner bg, centre + edges filled)", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ roundRectRadius: 40 }));
  await drawFull(page, m);
  expect(isRed(await pixelAt(page, 100, 70))).toBe(true);  // centre
  expect(isRed(await pixelAt(page, 100, 3))).toBe(true);   // straight top edge
  expect(isRed(await pixelAt(page, 3, 70))).toBe(true);    // straight left edge
  expect(isWhite(await pixelAt(page, 2, 2))).toBe(true);   // cut top-left corner
  expect(isWhite(await pixelAt(page, 197, 2))).toBe(true); // cut top-right corner
});

test("radius 0 fills the corner (plain rectangle)", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ roundRectRadius: 0 }));
  await drawFull(page, m);
  expect(isRed(await pixelAt(page, 2, 2))).toBe(true); // corner filled when not rounded
});

test("the options bar Radius updates and clamps to >= 0", async ({ page }) => {
  await scene(page);
  await page.fill("#mv-roundrect-radius", "20");
  expect(await page.evaluate(() => (window as any).__mv.store.state.roundRectRadius)).toBe(20);
  await page.fill("#mv-roundrect-radius", "-5"); // below the floor
  expect(await page.evaluate(() => (window as any).__mv.store.state.roundRectRadius)).toBe(0);
});

test("the Rounded options segment selects the roundrect shape kind", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("shape"));
  await page.getByText("Rounded", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.shapeKind)).toBe("roundrect");
});
