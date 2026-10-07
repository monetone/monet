import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop heal-group ▸ Red Eye tool ────────────────────────────
// Adobe: the Red Eye tool removes red-eye from flash photos — position over (or
// drag a box around) the eye and it replaces the red pupil with a darkened neutral.
// Options bar: Pupil Size (area/sensitivity) and Darken Amount, both default 50%.
// Vision adds a 'redeye' region-drag tool + engine remove_red_eye(x,y,w,h,pupil,darken)
// that neutralizes red-dominant pixels. The per-pixel maths is covered by a Rust test;
// this covers the options→store wiring, that the engine op reaches the canvas, and a
// real mouse drag.
//   https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/remove-red-eye-in-flash-photos.html

const DOCW = 200;
const DOCH = 140;

const red = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "eye");
    mv.store.setTool("redeye");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

// ── UI: the Red Eye options bar (Pupil Size + Darken Amount) ────────
test("the Red Eye tool exposes Pupil Size + Darken Amount, defaulting to 50%", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("redeye"));
  await expect(page.getByText("Pupil Size", { exact: true })).toBeVisible();
  await expect(page.getByText("Darken Amount", { exact: true })).toBeVisible();
  const opts = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { pupil: s.redeyePupil, darken: s.redeyeDarken };
  });
  expect(opts.pupil).toBe(0.5);
  expect(opts.darken).toBe(0.5);
});

// ── Integration: remove_red_eye through the engine FFI ─────────────
test("remove_red_eye neutralizes red and spares non-red pixels", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "eye");
    const E = mv.engine.engine;
    E.select_rect(10, 10, 12, 12, 0);
    E.fill_selection(220, 20, 20, 255); // a red-eye patch
    E.select_none();
    E.remove_red_eye(0, 0, 40, 40, 128, 128); // defaults
    E.composite();
    const at = (x: number, y: number) => {
      const p = E.pick_color(x, y) >>> 0;
      return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 };
    };
    return { eye: at(15, 15), bg: at(2, 2) };
  });
  expect(r.eye.r).toBeLessThan(80); // red strongly reduced
  expect(Math.abs(r.eye.r - r.eye.g)).toBeLessThan(24); // near-neutral
  expect(Math.abs(r.eye.g - r.eye.b)).toBeLessThan(24);
  expect(r.bg.r).toBeGreaterThan(240); // white background untouched
  expect(r.bg.g).toBeGreaterThan(240);
});

// ── Mouse: dragging the Red Eye tool over a red patch removes the red
test("a real Red Eye drag over a red patch reduces the red", async ({ page }) => {
  const m = await setup(page);
  // Paint the whole document red, then commit so it's the active-layer content.
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_all();
    E.fill_selection(230, 25, 25, 255);
    E.select_none();
    E.composite();
    (window as any).__mv.engine.commit();
  });
  expect(await red(page, 100, 70)).toBeGreaterThan(200); // red before

  // Drag a rectangle over the centre with the Red Eye tool.
  await page.mouse.move(m.cx(60), m.cy(40));
  await page.mouse.down();
  await page.mouse.move(m.cx(100), m.cy(70), { steps: 3 });
  await page.mouse.move(m.cx(140), m.cy(100), { steps: 3 });
  await page.mouse.up();

  expect(await red(page, 100, 70)).toBeLessThan(80); // red removed where dragged
  expect(await red(page, 10, 10)).toBeGreaterThan(200); // outside the drag: still red
});
