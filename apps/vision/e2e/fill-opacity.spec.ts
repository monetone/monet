import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layers panel ▸ Fill opacity ──────────────────────────
// Adobe: the Layers panel shows BOTH Opacity and Fill. Opacity scales the whole
// layer including its layer effects; Fill scales only the layer's own pixels, not
// its effects. Vision's engine already models this (Layer.fill_opacity); this adds
// the missing Fill control to the panel. The per-pixel semantic is covered by a Rust
// test; this covers the control's presence, that the UI drives store.setFillOpacity,
// and that Fill reaches the engine and differs from Opacity.
//   https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html

const fillOf = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const l = s.layers.find((ly: any) => ly.id === s.activeLayerId);
    return { fill: l.fillOpacity, opacity: l.opacity };
  });

// ── UI: both controls present, defaulting to 100% ──────────────────
test("the Layers panel shows both an Opacity and a Fill control at 100%", async ({ page }) => {
  await gotoApp(page);
  // (Opacity also appears on each layer row; the header Fill control is unique.)
  await expect(page.getByRole("slider", { name: "Opacity" }).first()).toBeVisible();
  await expect(page.getByRole("slider", { name: "Fill" })).toBeVisible();
  expect(await fillOf(page)).toEqual({ fill: 100, opacity: 100 });
});

// ── UI → store: dragging the Fill slider drives store.setFillOpacity ─
test("the Fill slider drives store.fillOpacity independently of Opacity", async ({ page }) => {
  await gotoApp(page);
  const fill = page.getByRole("slider", { name: "Fill" });
  await fill.focus();
  await fill.press("Home"); // → 0%
  let st = await fillOf(page);
  expect(st.fill).toBe(0); // the UI control reached store.setFillOpacity
  expect(st.opacity).toBe(100); // Opacity is independent
  // …and it reached the engine.
  expect(await page.evaluate(async () => {
    const s = (window as any).__mv; return s.engine.engine.layer_fill_opacity(s.store.state.activeLayerId);
  })).toBeCloseTo(0, 5);
  await fill.press("End"); // → 100%
  st = await fillOf(page);
  expect(st.fill).toBe(100);
});

// ── Semantic: Fill spares effects, unlike Opacity ──────────────────
test("Fill 0 fades the layer's pixels but spares its stroke effect", async ({ page }) => {
  await gotoApp(page);
  const probe = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "fill"); // white background
    const E = mv.engine.engine;
    const id = E.add_layer("shape");
    E.set_active_layer(id);
    E.select_rect(8, 8, 8, 8, 0);
    E.fill_selection(200, 0, 0, 255); // the layer's OWN content: red
    E.select_none();
    // a 3px BLUE stroke OUTSIDE the shape: [enabled,blend,opacity,r,g,b,size,position(0=outside)]
    E.set_layer_effect(id, 9, new Float32Array([1, 0, 1, 0, 0, 1, 3, 0]));
    E.composite();
    const at = (x: number, y: number) => {
      const p = E.pick_color(x, y) >>> 0;
      return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 };
    };
    const base = { interior: at(11, 11), stroke: at(6, 11) };
    mv.store.setFillOpacity(id, 0); // Fill 0
    E.composite();
    const filled0 = { interior: at(11, 11), stroke: at(6, 11) };
    return { base, filled0 };
  });
  // Baseline: interior red, stroke blue.
  expect(probe.base.interior.r).toBeGreaterThan(180);
  expect(probe.base.stroke.b).toBeGreaterThan(180);
  // Fill 0: interior fades to the white bg, but the stroke is spared (still blue).
  expect(probe.filled0.interior.r).toBeGreaterThan(230);
  expect(probe.filled0.interior.g).toBeGreaterThan(230);
  expect(probe.filled0.interior.b).toBeGreaterThan(230);
  expect(probe.filled0.stroke.b).toBeGreaterThan(180);
  expect(probe.filled0.stroke.r).toBeLessThan(80);
});
