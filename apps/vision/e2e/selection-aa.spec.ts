import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop "Anti-alias" selection option ────────────────────────
// Adobe spec (helpx "Select pixels using anti-aliasing"): anti-aliasing smooths a
// selection's jagged edge by softening the transition at the boundary — ONLY the
// edge pixels change, so no detail is lost. It is a per-tool Options-bar checkbox
// (Elliptical Marquee, Lasso family, Magic Wand — NOT the rectangular marquee)
// that must be set BEFORE making the selection. The engine's ellipse was hard-
// edged (1-bit). These tests pin the smooth edge + the toggle.
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

// Fresh doc with the ellipse tool armed; returns the doc→client map (built from
// the live doc-canvas rect — see selection-modes.spec for the rationale).
async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "aa");
    mv.engine.engine.select_none();
    mv.engine.commit();
    mv.store.setTool("ellipse");
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

async function dragEllipse(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(m.cx(x0), m.cy(y0));
  await page.mouse.down();
  await page.mouse.move(m.cx((x0 + x1) / 2), m.cy((y0 + y1) / 2), { steps: 2 });
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 2 });
  await page.mouse.up();
}

// ── Integration: the engine flag through the FFI ───────────────────
test("set_selection_antialias toggles a smooth vs hard ellipse edge", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const count = (aa: boolean) => {
      const mv = (window as any).__mv;
      mv.store.newDocument(60, 60, "aa");
      const E = mv.engine.engine; // AFTER newDocument — it swaps the engine
      E.set_selection_antialias(aa);
      E.select_ellipse(6, 6, 48, 48, 0);
      const w = E.width(), h = E.height();
      const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * h);
      let partial = 0, full = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (v > 0 && v < 255) partial++; else if (v === 255) full++; }
      // sample centre and corner
      const at = (x: number, y: number) => buf[y * w + x];
      return { partial, full, centre: at(30, 30), corner: at(0, 0) };
    };
    return { on: count(true), off: count(false) };
  });
  expect(r.on.partial).toBeGreaterThan(20);  // AA → a ring of soft edge pixels
  expect(r.off.partial).toBe(0);             // hard edge → none
  expect(r.on.full).toBeGreaterThan(0);
  // interior/exterior identical either way (only the edge changes — "no detail lost")
  expect(r.on.centre).toBe(255); expect(r.off.centre).toBe(255);
  expect(r.on.corner).toBe(0); expect(r.off.corner).toBe(0);
});

// ── Mouse: a real elliptical-marquee drag ──────────────────────────
test("a real ellipse drag has a soft edge with Anti-alias on, hard with it off", async ({ page }) => {
  const m1 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ antiAlias: true }));
  await dragEllipse(page, m1, 40, 30, 160, 110);
  const soft = await partials(page);
  expect(soft).toBeGreaterThan(20);

  const m2 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ antiAlias: false }));
  await dragEllipse(page, m2, 40, 30, 160, 110);
  const hard = await partials(page);
  expect(hard).toBe(0);
});

// ── UI: the Anti-alias checkbox ────────────────────────────────────
test("Anti-alias checkbox shows for the ellipse marquee (not the rectangular one) and drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("ellipse"));
  const aa = page.getByRole("checkbox", { name: "Anti-alias" });
  await expect(aa).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.antiAlias)).toBe(true); // PS default
  await aa.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.antiAlias)).toBe(false);

  // the rectangular marquee has no anti-alias option in Photoshop
  await page.evaluate(() => (window as any).__mv.store.setTool("marquee"));
  await expect(page.getByRole("checkbox", { name: "Anti-alias" })).toHaveCount(0);
});
