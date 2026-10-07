import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Shift-constrain to 45° (Gradient + Move) ─────────────
// Adobe spec (helpx / community): holding Shift while dragging the Gradient tool
// constrains the gradient line to a multiple of 45°; the Move tool likewise
// constrains the move direction to horizontal/vertical/45°. The app ignored Shift
// for both.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/control-the-movement-of-a-selection.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
// Is there a blue marker pixel anywhere in document row `yy`?
async function blueInRow(page: Page, yy: number): Promise<boolean> {
  return await page.evaluate((yy) => {
    const E = (window as any).__mv.engine.engine, w = E.width();
    for (let x = 0; x < w; x++) {
      const c = E.pick_color(x, yy) >>> 0;
      if (((c >>> 8) & 255) > 150 && ((c >>> 24) & 255) < 100) return true;
    }
    return false;
  }, yy);
}

async function mapping(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

async function setupGradient(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "g");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black
    mv.store.setBackground({ h: 0, s: 0, v: 1, a: 1 }); // white → black→white gradient
    mv.store.setTool("gradient");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  return mapping(page);
}

async function setupMove(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "m");
    const E = mv.engine.engine;
    E.select_rect(6, 6, 12, 12, 0); E.fill_selection(30, 30, 220, 255); // blue marker
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("move");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  return mapping(page);
}

async function drag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, y0: number, x1: number, y1: number, shift: boolean) {
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(m.cx(x0), m.cy(y0));
  await page.mouse.down();
  await page.mouse.move(m.cx((x0 + x1) / 2), m.cy((y0 + y1) / 2), { steps: 3 });
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 3 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

// ── Mouse: Gradient Shift-constrain ────────────────────────────────
test("Shift constrains the gradient line to horizontal", async ({ page }) => {
  const m = await setupGradient(page);
  await drag(page, m, 40, 70, 160, 110, true); // ~18° tilt → snaps to 0°
  // horizontal gradient → the same value down a column…
  expect(Math.abs((await pixel(page, 100, 40))[0] - (await pixel(page, 100, 100))[0])).toBeLessThanOrEqual(10);
  // …and a real ramp across the row
  expect((await pixel(page, 150, 70))[0] - (await pixel(page, 50, 70))[0]).toBeGreaterThan(40);
});

test("without Shift the same drag makes a tilted gradient (varies down a column)", async ({ page }) => {
  const m = await setupGradient(page);
  await drag(page, m, 40, 70, 160, 110, false); // tilted ~18°
  expect(Math.abs((await pixel(page, 100, 40))[0] - (await pixel(page, 100, 100))[0])).toBeGreaterThan(25);
});

// ── Mouse: Move Shift-constrain ────────────────────────────────────
test("Shift constrains the move to horizontal (no vertical drift)", async ({ page }) => {
  const m = await setupMove(page);
  await drag(page, m, 100, 70, 160, 90, true); // dx=60,dy=20 → snaps to horizontal
  expect(await blueInRow(page, 12)).toBe(true);  // marker still at its original row
  expect(await blueInRow(page, 30)).toBe(false); // it did NOT drift down
});

test("without Shift the move follows the drag's vertical component", async ({ page }) => {
  const m = await setupMove(page);
  await drag(page, m, 100, 70, 160, 90, false); // dx=60,dy=20 → also moves down
  expect(await blueInRow(page, 30)).toBe(true);  // marker drifted down to ~y=30
});
