import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop selection-combine modes + marquee modifiers ──────────
// Adobe spec (helpx / photoshopessentials): the modifier held when the drag
// STARTS picks the combine mode — Shift = add, Alt/Option = subtract,
// Shift+Alt = intersect, none = the options-bar mode; the modifier held WHILE
// dragging shapes the marquee — Shift constrains to a square/circle, Alt draws
// it from the center. The engine has always supported all four combine modes
// (SelMode 0..3); the UI used to emit Add for Shift+Alt instead of Intersect and
// never constrained or centered the marquee. These tests pin the fixed wiring.
//
//   https://helpx.adobe.com/ph_fil/photoshop/how-to/add-to-subtract-from-selections.html
//   https://www.photoshopessentials.com/basics/photoshop-selection-basics-the-rectangular-and-elliptical-marquee-tools/

const DOCW = 200;
const DOCH = 140;

// Fresh doc with the given selection tool armed. newDocument auto-fits (zooms the
// small doc up and centres it below the options bar); we let that settle, then
// build the doc→client map from the live document-canvas rect, which already
// bakes in zoom+pan — exactly the inverse of CanvasView.toDoc, so no viewport or
// pan guessing is needed. The doc/overlay canvases share the largest rect.
async function setup(page: Page, tool: "marquee" | "ellipse" = "marquee"): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, tool }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "selmodes");
    mv.engine.engine.select_none();
    mv.engine.commit();
    mv.store.setTool(tool);
    mv.store.fit();
  }, { w: DOCW, h: DOCH, tool });
  // Wait for the auto-fit to settle (small doc → zoomed up well past 1×).
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return {
    cx: (d: number) => box.x + d * box.w / DOCW,
    cy: (d: number) => box.y + d * box.h / DOCH,
  };
}

// Coverage (0..255) of the live selection mask at a doc pixel; -1 if nothing is
// selected (whole-doc / deselected). Rebuilds the wasm view fresh (memory moves).
async function cov(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    if (!E.has_selection()) return -1;
    const w = E.width();
    const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * E.height());
    return buf[y * w + x];
  }, { x, y });
}

async function bounds(page: Page): Promise<number[]> {
  return await page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);
}

async function setBase(page: Page, x: number, y: number, w: number, h: number) {
  await page.evaluate(({ x, y, w, h }) => (window as any).__mv.engine.engine.select_rect(x, y, w, h, 0), { x, y, w, h });
}

// One marquee drag. `downMods` are pressed BEFORE mousedown (so they set the
// combine mode AND, being held through the drag, also shape it); `dragMods` are
// pressed AFTER mousedown (so they ONLY shape it — the Photoshop timing trick).
async function drag(
  page: Page,
  m: { cx: (d: number) => number; cy: (d: number) => number },
  x0: number, y0: number, x1: number, y1: number,
  opts: { downMods?: string[]; dragMods?: string[] } = {},
) {
  const { downMods = [], dragMods = [] } = opts;
  await page.mouse.move(m.cx(x0), m.cy(y0));
  for (const k of downMods) await page.keyboard.down(k);
  await page.mouse.down();
  for (const k of dragMods) await page.keyboard.down(k);
  await page.mouse.move(m.cx((x0 + x1) / 2), m.cy((y0 + y1) / 2), { steps: 2 });
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 2 });
  await page.mouse.up();
  for (const k of [...dragMods, ...downMods]) await page.keyboard.up(k);
}

// ── Integration: the four combine modes through the engine FFI ─────
test.describe("combine modes (engine FFI)", () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); await page.evaluate(({ w, h }) => { (window as any).__mv.store.newDocument(w, h, "ffi"); }, { w: DOCW, h: DOCH }); });

  test("select_rect modes 0..3 (new/add/subtract/intersect) combine correctly", async ({ page }) => {
    const r = await page.evaluate(() => {
      const mv = (window as any).__mv, E = mv.engine.engine;
      const w = E.width();
      const peek = () => { const b = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * E.height()); return (x: number, y: number) => b[y * w + x]; };
      E.select_rect(20, 20, 60, 60, 0); // New: A = [20,80)x[20,80)
      const a = peek();
      const newOk = a(40, 40) === 255 && a(120, 40) === 0;
      E.select_rect(110, 20, 60, 60, 1); // Add: B = [110,170)
      const b = peek();
      const addOk = b(40, 40) === 255 && b(140, 40) === 255 && b(95, 40) === 0;
      E.select_rect(20, 20, 30, 60, 2); // Subtract a strip from A's left
      const c = peek();
      const subOk = c(25, 40) === 0 && c(60, 40) === 255 && c(140, 40) === 255;
      E.select_rect(110, 20, 60, 60, 3); // Intersect with B's box → only B remains
      const d = peek();
      const intOk = d(140, 40) === 255 && d(60, 40) === 0 && d(25, 40) === 0;
      return { newOk, addOk, subOk, intOk, bnd: Array.from(E.selection_bounds()) };
    });
    expect(r.newOk).toBe(true);
    expect(r.addOk).toBe(true);
    expect(r.subOk).toBe(true);
    expect(r.intOk).toBe(true);
    expect(r.bnd).toEqual([110, 20, 60, 60]); // intersect collapsed the selection to B
  });

  test("select_ellipse intersect (mode 3) keeps only the lens of two circles", async ({ page }) => {
    const r = await page.evaluate(() => {
      const mv = (window as any).__mv, E = mv.engine.engine;
      const w = E.width();
      E.select_ellipse(20, 30, 80, 80, 0);
      E.select_ellipse(60, 30, 80, 80, 3);
      const b = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * E.height());
      const at = (x: number, y: number) => b[y * w + x];
      return { lens: at(80, 70), leftOnly: at(30, 70), rightOnly: at(130, 70) };
    });
    expect(r.lens).toBe(255);    // overlap kept
    expect(r.leftOnly).toBe(0);  // first-circle-only dropped
    expect(r.rightOnly).toBe(0); // second-circle-only never added
  });
});

// ── Mouse: real pointer drags + keyboard modifiers ─────────────────
test.describe("marquee modifiers (mouse)", () => {
  test("plain drag makes a New selection, replacing the prior one", async ({ page }) => {
    const m = await setup(page);
    await setBase(page, 10, 10, 180, 120);
    await drag(page, m, 50, 40, 120, 100);
    expect(await cov(page, 80, 70)).toBe(255);  // inside the new marquee
    expect(await cov(page, 20, 20)).toBe(0);     // old base, outside new → replaced away
    const b = await bounds(page);
    expect(b[0]).toBeGreaterThanOrEqual(47); expect(b[0]).toBeLessThanOrEqual(53);
    expect(b[2]).toBeGreaterThanOrEqual(67); expect(b[2]).toBeLessThanOrEqual(73);
  });

  test("Shift-drag ADDS to the selection (union)", async ({ page }) => {
    const m = await setup(page);
    await setBase(page, 20, 20, 60, 60); // A = [20,80)
    await drag(page, m, 110, 20, 170, 80, { downMods: ["Shift"] }); // B = [110,170)
    expect(await cov(page, 40, 40)).toBe(255);  // A kept
    expect(await cov(page, 140, 40)).toBe(255); // B added
    expect(await cov(page, 95, 40)).toBe(0);    // gap between them stays unselected
  });

  test("Alt-drag SUBTRACTS from the selection", async ({ page }) => {
    const m = await setup(page);
    await setBase(page, 20, 20, 160, 100); // big A
    // Alt held from the start → subtract, drawn from the center.
    await drag(page, m, 100, 70, 130, 90, { downMods: ["Alt"] });
    expect(await cov(page, 100, 70)).toBe(0);   // center hole removed
    expect(await cov(page, 40, 40)).toBe(255);  // A outside the hole kept
    expect(await cov(page, 165, 110)).toBe(255);
  });

  test("Shift+Alt-drag INTERSECTS the selection (the parity fix; was Add)", async ({ page }) => {
    const m = await setup(page);
    await setBase(page, 20, 20, 160, 100); // A = [20,180)x[20,120)
    // Shift+Alt from the start → intersect, drawn as a from-center square.
    await drag(page, m, 100, 70, 140, 80, { downMods: ["Shift", "Alt"] });
    // Square is centered at (100,70), half-size 40 → [60,140)x[30,110), inside A.
    expect(await cov(page, 100, 70)).toBe(255);  // overlap kept
    expect(await cov(page, 40, 40)).toBe(0);     // A-only — under the OLD Add bug this was 255
    expect(await cov(page, 165, 110)).toBe(0);   // A-only on the far side, dropped
    const b = await bounds(page);
    expect(Math.abs(b[2] - b[3])).toBeLessThanOrEqual(2); // intersect rect is the square
    expect(b[2]).toBeLessThan(160);                       // collapsed well inside A
  });

  test("Shift while dragging CONSTRAINS the marquee to a square", async ({ page }) => {
    const m = await setup(page);
    // Mouse down first (mode = New), THEN Shift → constrain only, no Add.
    await drag(page, m, 60, 40, 150, 80, { dragMods: ["Shift"] }); // dx=90, dy=40
    const b = await bounds(page);
    expect(Math.abs(b[2] - b[3])).toBeLessThanOrEqual(2); // square: w ≈ h
    expect(b[2]).toBeGreaterThanOrEqual(87); expect(b[2]).toBeLessThanOrEqual(93); // side ≈ 90 (the larger delta)
    expect(b[0]).toBeGreaterThanOrEqual(57); expect(b[0]).toBeLessThanOrEqual(63); // anchored at the start corner
  });

  test("Alt while dragging draws the marquee FROM THE CENTER", async ({ page }) => {
    const m = await setup(page);
    await drag(page, m, 100, 70, 140, 100, { dragMods: ["Alt"] }); // dx=40, dy=30
    const b = await bounds(page);
    const ccx = b[0] + b[2] / 2, ccy = b[1] + b[3] / 2;
    expect(Math.abs(ccx - 100)).toBeLessThanOrEqual(3); // centered on the down point…
    expect(Math.abs(ccy - 70)).toBeLessThanOrEqual(3);  // …not anchored at a corner (that would be 120,85)
    expect(b[2]).toBeGreaterThanOrEqual(77); expect(b[2]).toBeLessThanOrEqual(83); // w ≈ 2*40
    expect(b[3]).toBeGreaterThanOrEqual(57); expect(b[3]).toBeLessThanOrEqual(63); // h ≈ 2*30
  });
});

// ── UI: the options bar exposes the Intersect mode ─────────────────
test.describe("selection mode options bar", () => {
  test("marquee options bar offers New/Add/Subtract/Intersect and Intersect sets selMode 3", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => (window as any).__mv.store.setTool("marquee"));
    for (const name of ["New", "Add", "Subtract", "Intersect"]) {
      await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();
    }
    await page.getByRole("radio", { name: "Intersect", exact: true }).click();
    expect(await page.evaluate(() => (window as any).__mv.store.state.selMode)).toBe(3);
  });
});
