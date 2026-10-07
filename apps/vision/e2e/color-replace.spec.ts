import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop brush group ▸ Color Replacement ──────────────────────
// Adobe: the Color Replacement tool paints the foreground's hue+saturation onto
// the pixels under the brush while preserving their luminance (its default "Color"
// mode), so shading/texture shows through (e.g. recolour a red car to blue, keeping
// the highlights/shadows). Vision adds it as brush mode 6 (a Color-blend dab). The
// luminance-preservation maths is covered by a Rust test; this covers the tool +
// that the recolour reaches the canvas, incl. a real mouse drag.
//   https://helpx.adobe.com/photoshop/using/replacing-object-colors-images.html

const DOCW = 160;
const DOCH = 120;

const rgbAt = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => { const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; }, { x, y });

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "cr");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(220, 20, 20, 255); E.select_none(); E.composite(); // whole doc red
    mv.store.setForeground({ h: 240, s: 1, v: 1, a: 1 }); // blue foreground
    mv.store.setBrush({ size: 14, hardness: 1, smoothing: 0 });
    mv.store.setTool("colorreplace");
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

// ── UI: the tool + options ─────────────────────────────────────────
test("the Color Replacement tool selects and shows the brush options + hint", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("colorreplace"));
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("colorreplace");
  await expect(page.getByText("Size", { exact: true })).toBeVisible();
  await expect(page.getByText("Replaces color with the foreground, keeping brightness")).toBeVisible();
});

// ── Integration: recolours the hue but preserves luminance ──────────
test("Color Replacement shifts hue to the foreground while preserving luminance", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "cr");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 10, 0); E.fill_selection(80, 0, 0, 255);  // top: dark red
    E.select_rect(0, 10, 20, 10, 0); E.fill_selection(240, 0, 0, 255); // bottom: bright red
    E.select_none();
    E.set_brush(26, 1, 1, 1, 0.2, 0, 0, 255, 255, false); // blue brush
    E.set_brush_mode(6);
    E.stroke_begin(); E.stroke_to(10, 4, 1); E.stroke_to(10, 16, 1); E.stroke_end(); E.composite();
    const at = (x: number, y: number) => { const p = E.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; };
    return { dark: at(10, 4), bright: at(10, 15) };
  });
  // Hue recoloured toward blue in both regions.
  expect(r.dark.b).toBeGreaterThan(r.dark.r);
  expect(r.bright.b).toBeGreaterThan(r.bright.r);
  // Luminance preserved: the originally-bright region stays brighter than the dark one.
  const lum = (c: { r: number; g: number; b: number }) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
  expect(lum(r.bright)).toBeGreaterThan(lum(r.dark) + 10);
});

// ── Mouse: a real Color Replacement drag recolours ─────────────────
test("a real Color Replacement drag shifts the hue toward the foreground", async ({ page }) => {
  const m = await setup(page);
  expect((await rgbAt(page, 80, 60)).r).toBeGreaterThan(150); // red before
  await page.mouse.move(m.cx(50), m.cy(60));
  await page.mouse.down();
  await page.mouse.move(m.cx(110), m.cy(60), { steps: 4 });
  await page.mouse.up();
  const after = await rgbAt(page, 80, 60);
  expect(after.b).toBeGreaterThan(after.r); // recoloured toward the blue foreground where dragged
});
