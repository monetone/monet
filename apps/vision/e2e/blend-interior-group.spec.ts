import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop Blending Options ▸ Blend Interior Effects as Group (default off).
// When on, the fill + interior effects composite as one group through the layer's
// blend mode, so a Multiply layer multiplies its Color Overlay into the backdrop.
test("Blend Interior Effects as Group applies the layer's blend mode", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(10, 10, "big");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 10, 10, 0); E.fill_selection(0, 255, 0, 255); E.select_none(); // green backdrop
    const id = E.add_layer("fx");
    E.select_rect(0, 0, 10, 10, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); // white fill
    E.set_layer_blend(id, 3); // Multiply
    E.set_layer_effect(id, 6, new Float32Array([1, 0, 1, 1, 0, 0])); // red Color Overlay
    E.composite();
    const off = E.pick_color(5, 5); // ungrouped: overlay composites Normal → red
    mv.store.setBlendInteriorGroup(id, true);
    E.composite();
    const on = E.pick_color(5, 5); // grouped: overlay is multiplied with the backdrop
    return { off, on, flag: mv.store.blendInteriorGroup(id) };
  });
  expect(r.flag).toBe(true);
  expect(r.on).not.toBe(r.off);
});
