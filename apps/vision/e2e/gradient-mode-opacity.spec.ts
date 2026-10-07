import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Gradient tool ▸ Mode + Opacity ───────────────────────
// Adobe: the Gradient options bar has a blend Mode and an Opacity that control how
// the gradient composites onto the existing pixels. Vision's gradient always drew
// Normal at 100%. The engine now threads a blend + opacity through gradient_fill
// (verified in Rust); here we assert the store→CanvasView→engine wiring via a real
// gradient drag with a solid gradient (uniform result, so drag geometry is moot).
//   https://helpx.adobe.com/photoshop/using/applying-gradient.html

const DOCW = 40;
const DOCH = 30;

// White doc, a solid-black gradient, the given Mode/Opacity; drag a gradient line
// and return the red channel (0..255) of a filled pixel.
async function gradientDragRed(page: Page, mode: string, opacity: number): Promise<number> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => (window as any).__mv.store.newDocument(w, h, "gr"), { w: DOCW, h: DOCH });
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); mv.engine.commit();
    mv.store.setTool("gradient");
    mv.store.setOptions({ gradientStops: [{ pos: 0, r: 0, g: 0, b: 0, a: 255 }, { pos: 1, r: 0, g: 0, b: 0, a: 255 }] });
  });
  await page.evaluate(({ m, o }) => {
    const s = (window as any).__mv.store;
    s.setOptions({ gradientMode: m, gradientOpacity: o, gradientType: "linear", gradientTransparency: true, gradientReverse: false, gradientDither: false });
    s.fit();
  }, { m: mode, o: opacity });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / DOCW;
  const cy = (d: number) => box.y + d * box.h / DOCH;
  await page.mouse.move(cx(5), cy(15));
  await page.mouse.down();
  await page.mouse.move(cx(35), cy(15), { steps: 5 });
  await page.mouse.up();
  return page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(20, 15) >>> 0) >>> 24 & 255);
}

test("Gradient Opacity blends the fill onto the canvas", async ({ page }) => {
  // Solid black gradient over white at 100% → black (R≈0).
  const full = await gradientDragRed(page, "normal", 1);
  expect(full).toBeLessThan(20);
  // At 50% → mid grey (R≈127).
  const half = await gradientDragRed(page, "normal", 0.5);
  expect(half).toBeGreaterThan(100);
  expect(half).toBeLessThan(160);
});

test("the Gradient options bar offers a Mode control that drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("gradient"));
  const mode = page.getByLabel("Gradient blend mode");
  await expect(mode).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientMode)).toBe("normal");
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientOpacity)).toBe(1); // default 100%
  await chooseOption(mode, "multiply");
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientMode)).toBe("multiply");
});
