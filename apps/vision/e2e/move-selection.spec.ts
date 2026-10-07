import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Move tool with an active selection ───────────────────
// Adobe spec (helpx "Move and adjust selections"): the Move tool cuts and drags
// the SELECTED pixels to a new location (a "floating selection") — the marquee
// moves with them and a hole is left where they were (transparent on a normal
// layer; background-coloured on a locked Background). With NO selection the Move
// tool relocates the whole layer. The app only ever moved the whole layer.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/move-selection-or-selection-border.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]; // r,g,b,a
  }, { x, y });
}
const bounds = (page: Page) => page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);

// Doc with a green square [40,80)² (the subject) and a blue marker [8,16)²
// (outside it, to prove the rest of the layer doesn't move). Returns doc→client.
async function setup(page: Page, selectSubject: boolean): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, sel }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "mv");
    const E = mv.engine.engine; // AFTER newDocument
    E.select_rect(40, 40, 40, 40, 0); E.fill_selection(0, 200, 0, 255);   // green subject
    E.select_rect(8, 8, 8, 8, 0); E.fill_selection(0, 0, 220, 255);       // blue marker
    if (sel) E.select_rect(40, 40, 40, 40, 0); else E.select_none();
    mv.engine.commit();
    mv.store.setTool("move");
    mv.store.fit();
  }, { w: DOCW, h: DOCH, sel: selectSubject });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

async function dragMove(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(m.cx(x0), m.cy(y0));
  await page.mouse.down();
  await page.mouse.move(m.cx((x0 + x1) / 2), m.cy((y0 + y1) / 2), { steps: 4 });
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 4 });
  await page.mouse.up();
}

// ── Integration: move_selection through the engine FFI ─────────────
test("move_selection relocates pixels + marquee, leaves a hole, and undoes", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "mv");
    const E = mv.engine.engine;
    E.select_rect(4, 4, 4, 4, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(4, 4, 4, 4, 0);
    E.move_selection(6, 6, 0, 0, 0);
    E.composite();
    const px = (x: number, y: number) => { const c = E.pick_color(x, y) >>> 0; return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]; };
    const moved = { dest: px(11, 11), holeA: px(5, 5)[3], bnd: Array.from(E.selection_bounds()) };
    mv.store.undo(); E.composite();
    const undone = { src: px(5, 5), bnd: Array.from(E.selection_bounds()) };
    return { moved, undone };
  });
  expect(r.moved.dest[0]).toBeGreaterThan(200);   // red landed at the destination
  expect(r.moved.holeA).toBe(0);                  // source vacated → transparent hole
  expect(r.moved.bnd).toEqual([10, 10, 4, 4]);    // marquee moved with the pixels
  expect(r.undone.src[0]).toBeGreaterThan(200);   // undo restored the red at the source
  expect(r.undone.bnd).toEqual([4, 4, 4, 4]);     // …and the selection
});

// ── Mouse: a real Move-tool drag floats the selection ──────────────
test("Move-tool drag with a selection moves the selected pixels, not the whole layer", async ({ page }) => {
  const m = await setup(page, true);
  await dragMove(page, m, 60, 60, 130, 90); // +70,+30, grabbing inside the selection

  const dest = await pixel(page, 130, 90); // green subject's new home (green: r≈0,g≈200)
  expect(dest[0]).toBeLessThan(80);
  expect(dest[1]).toBeGreaterThan(150);
  expect(dest[3]).toBeGreaterThan(200);
  expect((await pixel(page, 60, 60))[3]).toBe(0); // hole at the old spot (transparent)
  // the blue marker outside the selection did NOT move (only the selection floated).
  // Blue = low red; the white base = high red — so red distinguishes them.
  const marker = await pixel(page, 12, 12);
  expect(marker[0]).toBeLessThan(80); expect(marker[2]).toBeGreaterThan(150); // still blue here
  expect((await pixel(page, 82, 42))[0]).toBeGreaterThan(150); // white base — marker NOT relocated here
  // the marquee followed the pixels
  const b = await bounds(page);
  expect(Math.abs(b[0] - 110)).toBeLessThanOrEqual(2);
  expect(Math.abs(b[1] - 70)).toBeLessThanOrEqual(2);
});

// ── Mouse: no selection → the whole layer moves (unchanged path) ───
test("Move-tool drag with NO selection relocates the whole layer", async ({ page }) => {
  const m = await setup(page, false);
  await dragMove(page, m, 100, 70, 170, 100); // +70,+30
  // the blue marker (low red, high blue) relocated with the whole layer
  const moved = await pixel(page, 82, 42);
  expect(moved[0]).toBeLessThan(80); expect(moved[2]).toBeGreaterThan(150);
  expect((await pixel(page, 12, 12))[3]).toBe(0); // its old spot vacated by the layer shift
});
