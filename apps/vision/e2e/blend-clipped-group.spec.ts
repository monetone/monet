import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop Blending Options ▸ Blend Clipped Layers as Group (set on a clip base;
// default off in Vision to preserve existing renders). When on, the base + its
// clipped layers composite as one group through the base's blend mode.
test("Blend Clipped Layers as Group applies the base's blend mode", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(10, 10, "clp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 10, 10, 0); E.fill_selection(0, 255, 0, 255); E.select_none(); // green backdrop
    const base = E.add_layer("base");
    E.select_rect(0, 0, 10, 10, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); // white base
    E.set_layer_blend(base, 3); // Multiply
    const clip = E.add_layer("clip");
    E.select_rect(0, 0, 10, 10, 0); E.fill_selection(255, 0, 0, 255); E.select_none(); // red clipped layer
    E.set_layer_clipping(clip, true);
    E.composite();
    const off = E.pick_color(5, 5); // ungrouped: red clip composites Normal → red
    mv.store.setBlendClippedGroup(base, true);
    E.composite();
    const on = E.pick_color(5, 5); // grouped: the whole group multiplies with the backdrop
    return { off, on, flag: mv.store.blendClippedGroup(base) };
  });
  expect(r.flag).toBe(true);
  expect(r.on).not.toBe(r.off);
});
