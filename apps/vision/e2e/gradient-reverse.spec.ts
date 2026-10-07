import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop gradient "Reverse" option ────────────────────────────
// Adobe spec (helpx "Apply gradient fills"): the gradient options bar has a
// Reverse checkbox that flips the gradient's colour ramp — the end colour ends up
// at the start point. The app had no Reverse; this adds it (t → 1−t, for all five
// styles).
//
//   https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html

const DOCW = 200;
const DOCH = 140;

const pixel = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => ((((window as any).__mv.engine.engine.pick_color(x, y)) >>> 0) >>> 24) & 255, { x, y });

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "rev");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black at the start
    mv.store.setBackground({ h: 0, s: 0, v: 1, a: 1 }); // white at the end
    mv.store.setTool("gradient");
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

async function dragGradient(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(m.cx(x0), m.cy(y0));
  await page.mouse.down();
  await page.mouse.move(m.cx((x0 + x1) / 2), m.cy((y0 + y1) / 2), { steps: 3 });
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 3 });
  await page.mouse.up();
}

// ── Integration: reverse through the engine FFI ────────────────────
test("gradient_fill reverse flips the colour ramp", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const bw = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]); // black→white
    const ends = (rev: boolean) => {
      mv.store.newDocument(40, 40, "g");
      const E = mv.engine.engine;
      E.gradient_fill(0, 20, 40, 20, 0, rev, bw, false, true, 0, 0, 1);
      E.composite();
      const red = (x: number) => ((E.pick_color(x, 20) >>> 0) >>> 24) & 255;
      return { l: red(2), r: red(38) };
    };
    return { fwd: ends(false), rev: ends(true) };
  });
  expect(r.fwd.l).toBeLessThan(60); expect(r.fwd.r).toBeGreaterThan(200);   // forward: dark→light
  expect(r.rev.l).toBeGreaterThan(200); expect(r.rev.r).toBeLessThan(60);   // reversed: light→dark
});

// ── Mouse: drawing with Reverse flips the result ───────────────────
test("the Reverse option flips a real mouse-drawn gradient", async ({ page }) => {
  // forward: black at the start (left), white at the end (right)
  const m1 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ gradientType: "linear", gradientReverse: false }));
  await dragGradient(page, m1, 40, 70, 160, 70);
  expect(await pixel(page, 50, 70)).toBeLessThan(60);
  expect(await pixel(page, 150, 70)).toBeGreaterThan(200);

  // reversed: now light at the start, dark at the end
  const m2 = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ gradientType: "linear", gradientReverse: true }));
  await dragGradient(page, m2, 40, 70, 160, 70);
  expect(await pixel(page, 50, 70)).toBeGreaterThan(200);
  expect(await pixel(page, 150, 70)).toBeLessThan(60);
});

// ── UI: the Reverse checkbox ───────────────────────────────────────
test("the gradient options bar exposes a Reverse checkbox wired to the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("gradient"));
  const rev = page.getByRole("checkbox", { name: "Reverse" });
  await expect(rev).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientReverse)).toBe(false);
  await rev.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientReverse)).toBe(true);
});
