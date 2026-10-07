import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// Tier-2 on-device neural filters (plan 06). The weights are user-supplied /
// gitignored, so in the browser e2e build no model is installed. These tests
// assert the WIRING: the new Neural Filters items are discoverable, Colorize
// degrades to the heuristic gradient-map when its model is absent, and the other
// drops surface a clean "not installed" message rather than an ORT crash.

test("the Tier-2 neural-filter items are wired in Filter ▸ Neural Filters", async ({ page }) => {
  await gotoApp(page);
  const labels = ["Depth Blur (AI)…", "Harmonize (AI)…", "Photo Restoration (AI)…", "Face-Aware Liquify (AI)…"];
  for (const label of labels) {
    await page.waitForFunction(
      (l) => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith(l)),
      label, { timeout: 5000 },
    );
  }
});

test("Colorize degrades to the heuristic when its model is absent", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 48, 32);
  const r = await page.evaluate(() => (window as any).__mv.ml.colorize());
  expect(r.ok).toBe(true);
  expect(r.model).toBe("heuristic");
});

test("an absent Tier-2 model rejects with a clean install hint", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 48, 32);
  const msg = await page.evaluate(async () => {
    try {
      await (window as any).__mv.ml.harmonize();
      return "resolved";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  expect(msg).toMatch(/not installed/);
});
