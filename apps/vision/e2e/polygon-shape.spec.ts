import { test, expect, type Page } from "@playwright/test";
import { gotoApp, composite } from "./helpers";

// ── Photoshop Polygon tool (regular polygon + star) ────────────────
// Adobe: the Polygon tool draws a regular N-sided polygon inscribed in the drag
// box; a Star option indents alternate vertices to an inner radius. Vision adds
// a "polygon" Shape kind that computes vertices (src/state/polygonShape.ts) and
// fills them via select_polygon + fill_selection (the Pen/Custom-shape path).
//   https://helpx.adobe.com/photoshop/using/drawing-shapes.html

const DOCW = 200;
const DOCH = 140;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "poly");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); // white bg
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red foreground
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "polygon" });
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

const dragFull = async (page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) => {
  await page.mouse.move(m.cx(0), m.cy(0));
  await page.mouse.down();
  await page.mouse.move(m.cx(200), m.cy(140), { steps: 8 });
  await page.mouse.up();
};

test("drawing a triangle (3 sides) fills its interior with the foreground", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ polygonSides: 3, polygonStar: false }));
  const before = await composite(page);
  await dragFull(page, m);
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
  expect(after.w).toBe(DOCW); expect(after.h).toBe(DOCH);
  const inside = await pixelAt(page, 100, 70);  // triangle centroid → red
  const corner = await pixelAt(page, 5, 5);     // outside near the apex → white
  expect(inside[0]).toBeGreaterThan(180); expect(inside[1]).toBeLessThan(80); expect(inside[2]).toBeLessThan(80);
  expect(corner[0]).toBeGreaterThan(230); expect(corner[1]).toBeGreaterThan(230); expect(corner[2]).toBeGreaterThan(230);
});

test("drawing a 5-point star fills its body", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ polygonSides: 5, polygonStar: true, polygonIndent: 0.5 }));
  const before = await composite(page);
  await dragFull(page, m);
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
  const center = await pixelAt(page, 100, 70); // star centre → red
  expect(center[0]).toBeGreaterThan(180); expect(center[1]).toBeLessThan(80); expect(center[2]).toBeLessThan(80);
});

test("the options bar drives sides + star (clamped to ≤24)", async ({ page }) => {
  await scene(page);
  await page.fill("#mv-polygon-sides", "7");
  expect(await page.evaluate(() => (window as any).__mv.store.state.polygonSides)).toBe(7);
  await page.fill("#mv-polygon-sides", "100"); // over the cap
  expect(await page.evaluate(() => (window as any).__mv.store.state.polygonSides)).toBe(24);
  // the Star checkbox + indent slider
  expect(await page.evaluate(() => (window as any).__mv.store.state.polygonStar)).toBe(false);
  await page.check("#mv-polygon-star");
  expect(await page.evaluate(() => (window as any).__mv.store.state.polygonStar)).toBe(true);
  await expect(page.locator("#mv-polygon-indent")).toBeVisible(); // appears once Star is on
});

test("the Polygon options segment selects the polygon shape kind", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("shape"));
  await page.getByText("Polygon", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.shapeKind)).toBe("polygon");
});
