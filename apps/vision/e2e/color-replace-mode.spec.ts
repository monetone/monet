import { test, expect } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Color Replacement ▸ Mode ─────────────────────────────
// Adobe: the Color Replacement options bar has a Mode dropdown — Hue / Saturation /
// Color (default) / Luminosity — choosing which component of the foreground is
// applied (the rest taken from the pixel). Vision maps these to the engine's
// non-separable blends. The per-mode maths is covered by a Rust test; this covers
// the dropdown→store wiring and that the Mode reaches the engine (Color recolours,
// Luminosity keeps the hue).
//   https://helpx.adobe.com/photoshop/using/replacing-object-colors-images.html

// ── UI: the Mode dropdown drives the store ─────────────────────────
test("the Color Replacement Mode dropdown drives store.colorReplaceMode", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("colorreplace"));
  const sel = page.locator("#mv-colorreplace-mode");
  await expect(sel).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.colorReplaceMode)).toBe(2); // Color default
  await chooseOption(sel, "3"); // Luminosity
  expect(await page.evaluate(() => (window as any).__mv.store.state.colorReplaceMode)).toBe(3);
});

// ── Integration: Color vs Luminosity produce different results ─────
test("Color mode recolours to the foreground; Luminosity keeps the base hue", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "crm");
    const E = mv.engine.engine;
    const stroke = (crMode: number) => {
      E.select_all(); E.fill_selection(200, 0, 0, 255); E.select_none(); // red
      E.set_brush(14, 1, 1, 1, 0.2, 0, 0, 255, 255, false); // blue brush
      E.set_brush_mode(6); E.set_color_replace_mode(crMode);
      E.stroke_begin(); E.stroke_to(10, 10, 1); E.stroke_end(); E.composite();
      const p = E.pick_color(10, 10) >>> 0;
      return { r: (p >>> 24) & 255, b: (p >>> 8) & 255 };
    };
    return { color: stroke(2), lum: stroke(3) };
  });
  expect(r.color.b).toBeGreaterThan(r.color.r); // Color mode → recoloured blue
  expect(r.lum.r).toBeGreaterThan(r.lum.b); // Luminosity mode → hue stays red (only brightness changes)
});
