import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Brush Tip Shape ▸ Angle + Roundness ──────────────────
// Adobe: the Brush Settings ▸ Brush Tip Shape has Roundness (squashes the round
// tip into an ellipse) and Angle (rotates it) — the basis of calligraphic brushes.
// Vision's dab was always a circle. The engine ellipse math is verified in Rust;
// here we assert the store→engine wiring via a real brush dab.
//   https://helpx.adobe.com/photoshop/using/creating-modifying-brushes.html

// Paint one hard black dab at (20,20) over a white doc with the given roundness;
// return the red channel (0..255) at (x,y): painted → ~0, unpainted white → 255.
async function dabRed(page: Page, roundness: number, x: number, y: number): Promise<number> {
  return page.evaluate(({ roundness, x, y }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "bs");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black
    mv.store.setTool("brush");
    mv.store.setBrush({ size: 20, hardness: 1, roundness, angle: 0, smoothing: 0, sizePressure: false });
    mv.store.beginBrushStroke();
    E.stroke_begin(); E.stroke_to(20, 20, 1); E.stroke_end();
    mv.store.endBrushStroke();
    E.composite();
    return ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
  }, { roundness, x, y });
}

test("Roundness squashes the dab into a wide ellipse", async ({ page }) => {
  await gotoApp(page);
  // Round (roundness 1): a point 6px above the centre is painted (black).
  expect(await dabRed(page, 1, 20, 26)).toBeLessThan(60);
  // Flat ellipse (roundness 0.3): the same vertical point is now outside (white)…
  expect(await dabRed(page, 0.3, 20, 26)).toBeGreaterThan(200);
  // …while a horizontal point at the same distance stays painted.
  expect(await dabRed(page, 0.3, 28, 20)).toBeLessThan(60);
});

test("the brush options bar offers Angle + Roundness that drive the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await expect(page.getByText("Roundness", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.roundness)).toBe(1); // default round
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.angle)).toBe(0);
  await page.evaluate(() => (window as any).__mv.store.setBrush({ roundness: 0.4, angle: 45 }));
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.roundness)).toBe(0.4);
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.angle)).toBe(45);
});
