import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop "Anti-alias" for the Magic Wand ──────────────────────
// Adobe spec (helpx): the Magic Wand (with the Lasso family and Elliptical
// Marquee) exposes an Anti-alias checkbox that smooths the selection's jagged
// edge — only boundary pixels get fractional coverage, no detail is lost. The
// engine's flood selection was hard-edged; this softens the flood boundary with
// a 1px coverage ramp, sharing the Selection.antialias flag + Options-bar checkbox.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/select-pixels-using-anti-aliasing.html

const DOCW = 200;
const DOCH = 140;

async function partials(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    if (!E.has_selection()) return -1;
    const w = E.width(), h = E.height();
    const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * h);
    let p = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (v > 0 && v < 255) p++; }
    return p;
  });
}

// Fresh two-colour doc (left red | right blue) with the wand armed at low tolerance.
async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "wand");
    const E = mv.engine.engine; // AFTER newDocument — it swaps the engine
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(220, 40, 40, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(40, 60, 220, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("wand");
    mv.store.setOptions({ wandTolerance: 0.1, wandContiguous: true });
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

// ── Integration: the flood fill through the engine FFI ─────────────
test("set_selection_antialias toggles a smooth vs hard wand edge", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const count = (aa: boolean) => {
      const mv = (window as any).__mv;
      mv.store.newDocument(40, 20, "w");
      const E = mv.engine.engine; // AFTER newDocument
      E.select_rect(0, 0, 20, 20, 0); E.fill_selection(220, 40, 40, 255);
      E.select_rect(20, 0, 20, 20, 0); E.fill_selection(40, 60, 220, 255);
      E.select_none();
      E.set_selection_antialias(aa);
      E.magic_wand(5, 10, 0.1, true, 0, true); // flood the red half
      const w = E.width(), h = E.height();
      const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * h);
      let partial = 0, full = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (v > 0 && v < 255) partial++; else if (v === 255) full++; }
      return { partial, full, interior: buf[10 * w + 5], far: buf[10 * w + 35] };
    };
    return { on: count(true), off: count(false) };
  });
  expect(r.on.partial).toBeGreaterThan(10); // AA softens the flood boundary
  expect(r.off.partial).toBe(0);
  expect(r.on.full).toBeGreaterThan(0);
  expect(r.on.interior).toBe(255); expect(r.off.interior).toBe(255);
  expect(r.on.far).toBe(0); expect(r.off.far).toBe(0);
});

// ── Mouse: a real wand click ───────────────────────────────────────
test("a real wand click has a soft edge with Anti-alias on, hard with it off", async ({ page }) => {
  const m1 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ antiAlias: true }));
  await page.mouse.click(m1.cx(40), m1.cy(70)); // click inside the red half
  const soft = await partials(page);
  expect(soft).toBeGreaterThan(20);

  const m2 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ antiAlias: false }));
  await page.mouse.click(m2.cx(40), m2.cy(70));
  const hard = await partials(page);
  expect(hard).toBe(0);
});

// ── UI: the Anti-alias checkbox on the wand ────────────────────────
test("the wand shows Anti-alias (the bucket does not) and it drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("wand"));
  const aa = page.getByRole("checkbox", { name: "Anti-alias" });
  await expect(aa).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.antiAlias)).toBe(true); // PS default
  await aa.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.antiAlias)).toBe(false);

  // the paint-bucket has no anti-alias option
  await page.evaluate(() => (window as any).__mv.store.setTool("bucket"));
  await expect(page.getByRole("checkbox", { name: "Anti-alias" })).toHaveCount(0);
});
