import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Gradient tool ▸ Noise gradient ─────────────────────────────────
// Photoshop's Noise gradient type fills the ramp with random colours (vs
// interpolating hand-placed stops), Roughness controlling the band count and
// Randomize reseeding. Vision generates it into the ordinary gradient stops
// (state/noiseGradient.ts), which the existing gradient tool then applies.

const stops = (page: Page) =>
  page.evaluate(() => (window as any).__mv.store.state.gradientStops.map((s: any) => [s.r, s.g, s.b]));

test("Randomize fills the gradient with a multi-stop noise ramp and reseeds", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("gradient"));
  const before = await stops(page); // default 2-stop black → white
  expect(before.length).toBe(2);

  const noise = page.locator("[data-mv-gradient-noise]");
  await expect(noise).toBeVisible(); // the control shows on the gradient options bar
  await noise.click();
  const first = await stops(page);
  expect(first.length).toBeGreaterThan(2); // a noise ramp at the default roughness

  await noise.click();
  const second = await stops(page);
  expect(second).not.toEqual(first); // Randomize reseeds to a different ramp
});

test("Roughness raises the noise band count", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("gradient"));
  await page.evaluate(() => (window as any).__mv.store.setOptions({ gradientNoiseRoughness: 0.1 }));
  await page.locator("[data-mv-gradient-noise]").click();
  const low = (await stops(page)).length;
  await page.evaluate(() => (window as any).__mv.store.setOptions({ gradientNoiseRoughness: 1 }));
  await page.locator("[data-mv-gradient-noise]").click();
  const high = (await stops(page)).length;
  expect(high).toBeGreaterThan(low);
});
