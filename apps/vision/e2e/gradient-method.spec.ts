import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Gradient tool ▸ Method (Perceptual / Linear / Classic) ──────────
// Adobe (PS 2023+) added an interpolation "Method" to the gradient options bar:
// the stops are blended in different colour spaces, so a Black→White ramp has a
// different mid-grey. Classic = gamma-space RGB (the app's prior behaviour and
// its default), Linear = linear light (brighter mid), Perceptual = Oklab
// (perceptually even, a darker mid). The engine math lives in Rust; here we prove
// the three methods differ through the FFI, that the store value reaches a real
// gradient drag, and that the options-bar control exists.
//   https://helpx.adobe.com/photoshop/using/creating-gradients.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((((window as any).__mv.engine.engine.pick_color(x, y)) >>> 0) >>> 24) & 255, { x, y });
}

test("the three methods blend the midtone in distinct colour spaces (engine)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => (window as any).__mv.store.newDocument(w, h, "gm"), { w: DOCW, h: DOCH });
  const r = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const bw = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]); // black→white
    const mid = (method: number) => {
      E.gradient_fill(0, 20, 40, 20, 0, false, bw, false, true, method, 0, 1);
      return (E.pick_color(20, 20) >>> 24) & 255;
    };
    return { classic: mid(0), perceptual: mid(1), linear: mid(2) };
  });
  expect(Math.abs(r.classic - 128)).toBeLessThanOrEqual(12); // gamma-space ≈128
  expect(r.linear).toBeGreaterThan(170); // linear light is brighter
  expect(r.perceptual).toBeLessThan(r.classic); // Oklab mid is darker
  expect(new Set([r.classic, r.perceptual, r.linear]).size).toBe(3); // all distinct
});

async function setup(page: Page): Promise<{ box: { x: number; y: number }; cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "gm");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black
    mv.store.setBackground({ h: 0, s: 0, v: 1, a: 1 }); // white
    mv.store.setTool("gradient");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const geo = await page.evaluate(() => {
    const el = document.querySelector("canvas")!.getBoundingClientRect();
    const z = (window as any).__mv.store.state.zoom;
    return { x: el.left, y: el.top, z };
  });
  return { box: geo, cx: (d) => geo.x + d * geo.z, cy: (d) => geo.y + d * geo.z };
}

async function dragMid(page: Page, method: "classic" | "perceptual"): Promise<number> {
  const { cx, cy } = await setup(page);
  await page.evaluate((m) => (window as any).__mv.store.setOptions({ gradientMethod: m }), method);
  await page.mouse.move(cx(0), cy(20));
  await page.mouse.down();
  await page.mouse.move(cx(40), cy(20), { steps: 8 });
  await page.mouse.up();
  return await pixel(page, 20, 20); // the midpoint
}

test("the store's Method reaches a real gradient drag", async ({ page }) => {
  const classicMid = await dragMid(page, "classic");
  const perceptualMid = await dragMid(page, "perceptual");
  expect(Math.abs(classicMid - 128)).toBeLessThanOrEqual(16); // Classic ≈ gamma-space mid
  expect(perceptualMid).toBeLessThan(classicMid - 8); // Perceptual (Oklab) mid is visibly darker
});

test("the Method control is exposed in the Gradient options bar with a Classic default", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("gradient"));
  await expect(page.getByText("Method", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientMethod)).toBe("classic");
});
