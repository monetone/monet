import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// Crop tool ▸ Content-Aware: dragging the crop box beyond the canvas exposes a
// border that is content-aware-filled from the image (a local inpaint) instead
// of left transparent. The engine op is verified in Rust; here we assert the
// end-to-end wiring — the option round-trips and the enlarging crop grows the
// canvas and fills the exposed border opaque.

test("content-aware crop grows the canvas and fills the exposed border", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 60, 40);

  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 60, 40, 0);
    E.fill_selection(220, 20, 20, 255); // solid red document
    E.select_none();
    mv.engine.commit();

    E.crop_content_aware(-10, -10, 80, 60); // enlarge by 10px on every side
    const c = E.pick_color(5, 5); // a pixel in the freshly-exposed border
    return {
      w: E.width(),
      h: E.height(),
      red: (c >>> 24) & 255,
      alpha: c & 255,
    };
  });

  expect(r.w).toBe(80);
  expect(r.h).toBe(60);
  expect(r.alpha).toBe(255); // the border is filled, not transparent
  expect(r.red).toBeGreaterThan(180); // filled from the surrounding red
});

test("the Content-Aware option is exposed in the Crop options bar", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("crop"));
  await expect(page.getByText("Content-Aware", { exact: true })).toBeVisible();
});
