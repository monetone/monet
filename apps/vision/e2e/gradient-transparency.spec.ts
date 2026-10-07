import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// Gradient tool ▸ Transparency: when checked (Photoshop default) the gradient's
// opacity stops paint, so a Black→Transparent gradient fades to reveal what is
// underneath; when unchecked the alpha of every stop is forced to 1 and the
// whole gradient paints fully opaque. The engine math is verified in Rust; here
// we assert the end-to-end wiring — the same fill on a white base reads white at
// the faded end with Transparency on, and solid black with it off.

function fadeToBlack(page: import("@playwright/test").Page, transparency: boolean) {
  return page.evaluate((t) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 60, 40, 0);
    E.fill_selection(255, 255, 255, 255); // white base
    E.select_none();
    mv.engine.commit();

    // [pos,r,g,b,a] per stop: opaque black at the left, transparent black right.
    const stops = new Float32Array([0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
    E.gradient_fill(0, 20, 60, 20, 0, false, stops, false, t, 0, 0, 1); // horizontal, no dither, Classic
    E.select_none();
    mv.engine.commit();

    const c = E.pick_color(55, 20); // near the faded (right) end
    return { red: (c >>> 24) & 255, alpha: c & 255 };
  }, transparency);
}

test("Transparency on lets a Black→Transparent gradient reveal the base", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 60, 40);
  const r = await fadeToBlack(page, true);
  expect(r.alpha).toBe(255);
  expect(r.red).toBeGreaterThan(200); // white base shows through the faded end
});

test("Transparency off paints the whole gradient fully opaque", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 60, 40);
  const r = await fadeToBlack(page, false);
  expect(r.alpha).toBe(255);
  expect(r.red).toBeLessThan(60); // stop alpha ignored — solid black
});

test("the Transparency option is exposed in the Gradient options bar", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("gradient"));
  await expect(page.getByText("Transparency", { exact: true })).toBeVisible();
});
