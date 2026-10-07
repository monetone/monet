import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Neural Filters ▸ JPEG Artifacts Removal — a classical 8×8-block deblocker
// (not Adobe's ML model). It softens the block seams JPEG compression leaves.
test("JPEG Artifacts Removal softens block seams", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(16, 4, "jpg");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 8, 4, 0); E.fill_selection(0, 0, 0, 255); // left block black
    E.select_rect(8, 0, 8, 4, 0); E.fill_selection(255, 255, 255, 255); // right block white
    E.select_none(); mv.engine.commit();
    const before = E.pick_color(7, 0); // the black side of the x=8 seam
    E.filter_deblock(1.0);
    E.composite();
    const after = E.pick_color(7, 0);
    return { before, after };
  });
  expect(r.after).not.toBe(r.before); // the seam softened
});
