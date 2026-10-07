import { test, expect, type Page } from "@playwright/test";
import { gotoApp, composite } from "./helpers";

// ── Photoshop clone group ▸ Pattern Stamp ──────────────────────────
// Adobe: the Pattern Stamp paints with the currently defined pattern (Edit ▸ Define
// Pattern), tiled and aligned to the canvas, with full brush dynamics. Vision adds
// it by reusing the clone stroke path: on stroke-begin it fills the clone source
// with the tiled pattern instead of a captured region. The tiling/erase maths is
// covered by a Rust test; this covers the tool/options, that the pattern reaches the
// stroke, and a real mouse drag.
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

const DOCW = 160;
const DOCH = 120;

// Define a solid-green pattern from a corner region (engine FFI).
async function defineGreenPattern(page: Page) {
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(0, 0, 6, 6, 0);
    E.fill_selection(0, 200, 0, 255);
    E.select_rect(0, 0, 6, 6, 0);
    E.define_pattern();
    E.select_none();
    E.composite();
  });
}

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => (window as any).__mv.store.newDocument(w, h, "ps"), { w: DOCW, h: DOCH });
  await defineGreenPattern(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.add_layer("paint");
    mv.store.setBrush({ size: 14, hardness: 1, smoothing: 0 });
    mv.store.setTool("patternstamp");
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

// ── UI: the tool + its options ─────────────────────────────────────
test("the Pattern Stamp tool selects and shows the brush options + hint", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("patternstamp"));
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("patternstamp");
  await expect(page.getByText("Size", { exact: true })).toBeVisible(); // brush options render
  await expect(page.getByText("Paints the defined pattern (Edit ▸ Define Pattern)")).toBeVisible();
});

// ── Integration: a pattern-stamp stroke paints the pattern; none → nothing ──
test("a Pattern Stamp stroke paints the defined pattern (and nothing without one)", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "ps");
    const E = mv.engine.engine;
    const bg = E.layer_id_at(0);
    const id = E.add_layer("paint");
    E.set_active_layer(id);
    E.set_brush(10, 1, 1, 1, 0.2, 0, 0, 0, 255, false);
    E.set_brush_mode(0);
    const rgb = (x: number, y: number) => { const p = E.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255, a: p & 255 }; };
    // No pattern defined yet → the stroke must paint nothing (composite stays white bg).
    E.set_pattern_stamp(true); E.set_clone(true, 0, 0);
    E.stroke_begin(); E.stroke_to(10, 10, 1); E.stroke_end(); E.composite();
    const noPat = rgb(10, 10);
    // Now define a green pattern and stamp.
    E.set_active_layer(bg);
    E.select_rect(0, 0, 4, 4, 0); E.fill_selection(0, 200, 0, 255); E.select_rect(0, 0, 4, 4, 0); E.define_pattern(); E.select_none();
    E.set_active_layer(id);
    E.set_pattern_stamp(true); E.set_clone(true, 0, 0);
    E.stroke_begin(); E.stroke_to(10, 10, 1); E.stroke_end(); E.composite();
    return { noPat, stamped: rgb(10, 10) };
  });
  // No pattern → nothing painted, the white background shows through.
  expect(r.noPat.r).toBeGreaterThan(250);
  expect(r.noPat.g).toBeGreaterThan(250);
  expect(r.noPat.b).toBeGreaterThan(250);
  // With a pattern → the green pattern was stamped.
  expect(r.stamped.g).toBeGreaterThan(r.stamped.r);
  expect(r.stamped.g).toBeGreaterThan(r.stamped.b);
  expect(r.stamped.a).toBeGreaterThan(200);
});

// ── Mouse: a real Pattern Stamp drag paints the pattern ────────────
test("a real Pattern Stamp drag paints the pattern", async ({ page }) => {
  const m = await setup(page);
  const before = await composite(page);
  await page.mouse.move(m.cx(60), m.cy(60));
  await page.mouse.down();
  await page.mouse.move(m.cx(100), m.cy(60), { steps: 4 });
  await page.mouse.up();
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk); // the pattern reached the canvas
  const px = await page.evaluate(() => (window as any).__mv.engine.engine.pick_color(80, 60) >>> 0);
  expect((px >>> 16) & 255).toBeGreaterThan((px >>> 24) & 255); // green dominant where dragged
});
