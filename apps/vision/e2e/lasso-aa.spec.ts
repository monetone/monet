import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop "Anti-alias" for the Lasso ───────────────────────────
// Adobe spec (helpx): the Lasso family (and Elliptical Marquee / Magic Wand)
// expose an Anti-alias checkbox that smooths the selection's jagged edge — only
// the boundary pixels get fractional coverage, no detail is lost. The engine's
// polygon/lasso fill was hard-edged (1-bit); this adds a supersampled soft edge,
// sharing the same Selection.antialias flag + Options-bar checkbox as the ellipse.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/select-pixels-using-anti-aliasing.html

const DOCW = 200;
const DOCH = 140;

// Count selection-mask pixels with fractional coverage (0 < v < 255) — the AA edge.
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

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "lasso");
    mv.engine.engine.select_none();
    mv.engine.commit();
    mv.store.setTool("lasso");
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

// Trace a freehand lasso path; the lasso auto-closes on pointer-up.
async function dragLasso(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, pts: number[][]) {
  await page.mouse.move(m.cx(pts[0][0]), m.cy(pts[0][1]));
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(m.cx(pts[i][0]), m.cy(pts[i][1]), { steps: 8 });
  await page.mouse.up();
}

// ── Integration: the polygon fill through the engine FFI ───────────
test("set_selection_antialias toggles a smooth vs hard lasso edge", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const count = (aa: boolean) => {
      const mv = (window as any).__mv;
      mv.store.newDocument(40, 40, "la");
      const E = mv.engine.engine; // AFTER newDocument — it swaps the engine
      E.set_selection_antialias(aa);
      const xs = new Float32Array([5, 35, 18]); // slanted-edged triangle
      const ys = new Float32Array([5, 8, 34]);
      E.select_polygon(xs, ys, 0);
      const w = E.width(), h = E.height();
      const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * h);
      let partial = 0, full = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (v > 0 && v < 255) partial++; else if (v === 255) full++; }
      return { partial, full, centroid: buf[16 * w + 19] };
    };
    return { on: count(true), off: count(false) };
  });
  expect(r.on.partial).toBeGreaterThan(15); // AA → soft edge pixels
  expect(r.off.partial).toBe(0);            // hard edge → none
  expect(r.on.full).toBeGreaterThan(0);
  expect(r.on.centroid).toBe(255);          // interior unchanged either way
  expect(r.off.centroid).toBe(255);
});

// ── Mouse: a real freehand lasso drag ──────────────────────────────
test("a real lasso drag has a soft edge with Anti-alias on, hard with it off", async ({ page }) => {
  const tri = [[40, 40], [150, 45], [95, 110]];

  const m1 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ antiAlias: true }));
  await dragLasso(page, m1, tri);
  const soft = await partials(page);
  expect(soft).toBeGreaterThan(20);

  const m2 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ antiAlias: false }));
  await dragLasso(page, m2, tri);
  const hard = await partials(page);
  expect(hard).toBe(0);
});

// ── UI: the Anti-alias checkbox on the lasso ───────────────────────
test("the lasso tool shows the Anti-alias checkbox and it drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("lasso"));
  const aa = page.getByRole("checkbox", { name: "Anti-alias" });
  await expect(aa).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.antiAlias)).toBe(true); // PS default
  await aa.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.antiAlias)).toBe(false);
});
