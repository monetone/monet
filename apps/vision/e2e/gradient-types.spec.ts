import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop's five gradient styles ───────────────────────────────
// Adobe spec (helpx "Apply gradient fills"): Linear (straight start→end), Radial
// (circle from start), Angle (clockwise sweep around the start→end angle),
// Reflected (mirror about the start), Diamond (diamond from start). The app only
// had Linear + Radial; this adds Angle, Reflected, Diamond.
//
//   https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((((window as any).__mv.engine.engine.pick_color(x, y)) >>> 0) >>> 24) & 255, { x, y });
}

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "grad");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black
    mv.store.setBackground({ h: 0, s: 0, v: 1, a: 1 }); // white → black→white gradient
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

// ── Integration: each kind's geometry through the engine FFI ───────
test("gradient_fill draws all five styles with the right geometry", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const bw = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    const sample = (kind: number) => {
      mv.store.newDocument(40, 40, "g");
      const E = mv.engine.engine;
      E.gradient_fill(20, 20, 40, 20, kind, false, bw, false, true, 0, 0, 1); // start centre, end right, len 20
      E.composite();
      const red = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      return red;
    };
    let red = sample(0); const lin = [red(20, 5), red(20, 35)];
    red = sample(1); const rad = [red(20, 20), red(20, 38)];
    red = sample(2); const ang = [red(20, 8), red(20, 32)];
    red = sample(3); const refl = [red(10, 20), red(30, 20), red(20, 20)];
    red = sample(4); const dia = [red(20, 30), red(20, 20)];
    return { lin, rad, ang, refl, dia };
  });
  expect(Math.abs(r.lin[0] - r.lin[1])).toBeLessThanOrEqual(4); // linear: constant perpendicular
  expect(r.rad[0]).toBeLessThan(60); expect(r.rad[1]).toBeGreaterThan(150); // radial: dark centre, light rim
  expect(r.ang[0] - r.ang[1]).toBeGreaterThan(60); // angle: sweep (opposite sides differ)
  expect(r.refl[0]).toBeGreaterThan(80); expect(r.refl[1]).toBeGreaterThan(80); expect(r.refl[2]).toBeLessThan(50); // reflected mirror
  expect(r.dia[0]).toBeGreaterThan(90); expect(r.dia[1]).toBeLessThan(50); // diamond: perpendicular brightens
});

// ── Mouse: a real radial gradient drag is concentric ───────────────
test("a real Radial gradient drag radiates from the start point", async ({ page }) => {
  const m = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ gradientType: "radial" }));
  await dragGradient(page, m, 100, 70, 160, 70); // centre → right, radius 60
  expect(await pixel(page, 100, 70)).toBeLessThan(60);   // dark at the centre
  expect(await pixel(page, 100, 30)).toBeGreaterThan(120); // light straight up (a LINEAR gradient would be dark here)
  expect(await pixel(page, 160, 70)).toBeGreaterThan(200); // light at the rim
});

// ── Mouse: a real reflected gradient drag mirrors at the start ─────
test("a real Reflected gradient drag mirrors about the start point", async ({ page }) => {
  const m = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ gradientType: "reflected" }));
  await dragGradient(page, m, 100, 70, 160, 70); // start at x=100, length 60
  expect(await pixel(page, 100, 70)).toBeLessThan(60);    // dark at the start
  expect(await pixel(page, 60, 70)).toBeGreaterThan(120);  // light to the LEFT (linear would clamp to black)
  expect(await pixel(page, 140, 70)).toBeGreaterThan(120); // light to the right — mirrored
});

// ── UI: the five style segments ────────────────────────────────────
test("the gradient options bar offers all five styles and they drive the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("gradient"));
  // Scope to the Type group — "Linear" is also a Method option (Perceptual/Linear/Classic).
  const type = page.getByRole("radiogroup", { name: "Type" });
  for (const name of ["Linear", "Radial", "Angle", "Reflected", "Diamond"]) {
    await expect(type.getByRole("radio", { name, exact: true })).toBeVisible();
  }
  await type.getByRole("radio", { name: "Diamond", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientType)).toBe("diamond");
  await type.getByRole("radio", { name: "Angle", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientType)).toBe("angle");
});
