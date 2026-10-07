import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Shape tool Shift/Alt modifiers ───────────────────────
// Adobe spec (same constrain rules as the marquee): holding Shift while dragging
// a Rectangle/Ellipse shape constrains it to a perfect square/circle; holding
// Alt/Option draws it from the center. The app's shape tool ignored both.
//
//   https://helpx.adobe.com/photoshop/using/drawing-shapes.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

async function setup(page: Page, shapeKind: "rect" | "ellipse"): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, shapeKind }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "shape");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red shape fill
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind });
    mv.store.fit();
  }, { w: DOCW, h: DOCH, shapeKind });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

async function dragShape(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, y0: number, x1: number, y1: number, opts: { shift?: boolean; alt?: boolean } = {}) {
  if (opts.shift) await page.keyboard.down("Shift");
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.move(m.cx(x0), m.cy(y0));
  await page.mouse.down();
  await page.mouse.move(m.cx((x0 + x1) / 2), m.cy((y0 + y1) / 2), { steps: 2 });
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 2 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
  if (opts.shift) await page.keyboard.up("Shift");
}

const red = (p: number[]) => p[1] < 80;   // red fill: green channel low
const empty = (p: number[]) => p[1] > 180; // white base: green channel high

// ── Integration: the fill pipeline through the engine FFI ──────────
test("a square selection fills a square; a circle selection is round", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const draw = (ellipse: boolean) => {
      mv.store.newDocument(40, 40, "s");
      const E = mv.engine.engine;
      if (ellipse) E.select_ellipse(10, 10, 20, 20, 0); else E.select_rect(10, 10, 20, 20, 0);
      E.fill_selection(255, 0, 0, 255); E.select_none(); E.composite();
      const g = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 16) & 255;
      return { corner: g(11, 11), centre: g(20, 20) };
    };
    return { sq: draw(false), ci: draw(true) };
  });
  expect(r.sq.corner).toBeLessThan(80);   // square: corner filled
  expect(r.ci.centre).toBeLessThan(80);   // circle: centre filled
  expect(r.ci.corner).toBeGreaterThan(180); // circle: bbox corner empty (round)
});

// ── Mouse: Shift constrains a rectangle to a square ────────────────
test("Shift constrains a rectangle shape to a square", async ({ page }) => {
  const m = await setup(page, "rect");
  await dragShape(page, m, 30, 20, 110, 60, { shift: true }); // dx=80, dy=40 → 80×80 square
  expect(red(await pixel(page, 60, 40))).toBe(true);   // inside
  expect(red(await pixel(page, 60, 90))).toBe(true);   // y=90 filled → the square grew to match the width
  expect(empty(await pixel(page, 60, 130))).toBe(true); // below the square → untouched
});

// ── Mouse: Alt draws from the center ───────────────────────────────
test("Alt draws a rectangle shape from the center", async ({ page }) => {
  const m = await setup(page, "rect");
  await dragShape(page, m, 100, 70, 140, 100, { alt: true }); // centre (100,70), half (40,30) → [60,140)×[40,100)
  expect(red(await pixel(page, 100, 70))).toBe(true); // the down point is the centre
  expect(red(await pixel(page, 70, 50))).toBe(true);  // up-left of it → only filled if drawn from centre
  expect(red(await pixel(page, 130, 95))).toBe(true); // down-right
});

// ── Mouse: Shift constrains an ellipse to a circle ─────────────────
test("Shift constrains an ellipse shape to a circle", async ({ page }) => {
  const m = await setup(page, "ellipse");
  await dragShape(page, m, 40, 40, 120, 80, { shift: true }); // dx=80, dy=40 → circle Ø80, centre (80,80)
  expect(red(await pixel(page, 80, 80))).toBe(true);    // centre filled
  expect(red(await pixel(page, 80, 110))).toBe(true);   // grew vertically into a circle (40-tall ellipse wouldn't reach)
  expect(empty(await pixel(page, 45, 45))).toBe(true);  // bbox corner empty → round, not square
});
