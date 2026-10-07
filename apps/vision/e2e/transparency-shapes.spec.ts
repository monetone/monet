import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop Blending Options ▸ Transparency Shapes Layer (default on). When off,
// the layer style ignores the layer's transparency and covers the full bounds.
test("Transparency Shapes Layer off extends effects to the full bounds", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "txs");
    const E = mv.engine.engine;
    const id = E.add_layer("fx");
    E.select_rect(0, 0, 4, 4, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); // small opaque square
    E.set_layer_effect(id, 6, new Float32Array([1, 0, 1, 1, 0, 0])); // red Color Overlay
    E.composite();
    const before = E.pick_color(16, 16); // transparent corner — no overlay by default
    mv.store.setTransparencyShapes(id, false);
    E.composite();
    const after = E.pick_color(16, 16); // now the overlay fills the whole layer
    return { before, after, flag: mv.store.transparencyShapes(id) };
  });
  expect(r.flag).toBe(false);
  expect(r.after).not.toBe(r.before);
});
