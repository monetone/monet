import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop brush Shift-click straight lines ─────────────────────
// Adobe spec / community: click a starting point with the brush, then move to the
// end, hold Shift and CLICK — a straight line is drawn from the last painted
// point to the click. (Shift while clicking is the constrain modifier.) The app
// only painted isolated dabs/drags; this connects Shift-clicks with a line.
//
//   https://community.adobe.com/t5/photoshop/straight-lines-using-brush-tool-shift/td-p/10180376

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

// Fresh white doc with the (black) brush armed; returns the doc→client map.
async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "line");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black, paints over the white base
    mv.store.setTool("brush");
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

const click = (page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x: number, y: number) =>
  page.mouse.click(m.cx(x), m.cy(y));
async function shiftClick(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x: number, y: number) {
  await page.keyboard.down("Shift");
  await page.mouse.click(m.cx(x), m.cy(y));
  await page.keyboard.up("Shift");
}

// ── Integration: the engine line primitive through the FFI ─────────
test("two stroke_to points paint the connecting line", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "l");
    const E = mv.engine.engine; // AFTER newDocument
    E.set_brush(4, 1, 1, 1, 0.1, 0, 0, 0, 255, false);
    E.stroke_begin(); E.stroke_to(5, 20, 1); E.stroke_to(35, 20, 1); E.stroke_end();
    E.composite();
    const px = (x: number, y: number) => (E.pick_color(x, y) >>> 0) >>> 24 & 255; // red channel
    return { mid: px(20, 20), end: px(34, 20), off: px(20, 5) };
  });
  expect(r.mid).toBeLessThan(100); // black-ish midpoint on the line
  expect(r.end).toBeLessThan(100);
  expect(r.off).toBeGreaterThan(200); // white off the line
});

// ── Mouse: Shift-click draws a straight line; plain clicks don't ───
test("Shift-click paints a straight line from the previous brush point", async ({ page }) => {
  const m = await setup(page);
  await click(page, m, 40, 70);      // anchor
  await shiftClick(page, m, 140, 70); // straight line to here
  // the midpoint between the two clicks is painted (black-ish), not white
  expect((await pixel(page, 90, 70))[0]).toBeLessThan(100);
  // a point off the line is untouched
  expect((await pixel(page, 90, 30))[0]).toBeGreaterThan(200);
});

test("two plain clicks leave separate dabs with no line between them", async ({ page }) => {
  const m = await setup(page);
  await click(page, m, 40, 70);
  await click(page, m, 140, 70); // NO shift → no connecting line
  // both clicks painted…
  expect((await pixel(page, 40, 70))[0]).toBeLessThan(100);
  expect((await pixel(page, 140, 70))[0]).toBeLessThan(100);
  // …but the midpoint between them is untouched white
  expect((await pixel(page, 90, 70))[0]).toBeGreaterThan(200);
});

// ── Mouse edge: a new document resets the line anchor ──────────────
test("a new document clears the Shift-click anchor (no stray line)", async ({ page }) => {
  const m = await setup(page);
  await click(page, m, 40, 70); // anchor on doc 1
  // open a second document (resets the anchor via the activeDocId effect)
  const m2 = await setupSecondDoc(page);
  await shiftClick(page, m2, 140, 70); // first click on doc 2 → just a dab, no line
  expect((await pixel(page, 140, 70))[0]).toBeLessThan(100); // the click itself paints
  expect((await pixel(page, 90, 70))[0]).toBeGreaterThan(200); // no line back to doc-1's anchor
});

async function setupSecondDoc(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "line2");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
    mv.store.setTool("brush");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForTimeout(150); // let the activeDocId effect clear the anchor
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}
