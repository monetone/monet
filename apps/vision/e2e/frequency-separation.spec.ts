import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite, layerCount } from "./helpers";

// Frequency Separation (Filter ▸ Frequency Separation…) builds the classic
// retouching stack: a Low Frequency (Gaussian) layer + a High Frequency
// (High Pass / Linear Light) layer above the untouched source.
test.describe("Frequency Separation", () => {
  test("splits the active layer into Low + High Frequency layers", async ({ page }) => {
    await gotoApp(page);
    await newScene(page, 256, 192);
    const before = await layerCount(page);
    const sig = await composite(page);

    await page.evaluate(() => (window as any).__mv.frequencySeparation(8));

    const after = await layerCount(page);
    expect(after).toBe(before + 2); // two copies added, source kept

    const layers = await page.evaluate(() =>
      (window as any).__mv.store.state.layers.map((l: { name: string; blendMode: string }) => ({
        name: l.name,
        blend: l.blendMode,
      })),
    );
    const high = layers.find((l: { name: string }) => l.name === "High Frequency");
    const low = layers.find((l: { name: string }) => l.name === "Low Frequency");
    expect(high, "High Frequency layer exists").toBeTruthy();
    expect(low, "Low Frequency layer exists").toBeTruthy();
    expect(high.blend).toBe("linear-light"); // detail layer reconstructs over the blur

    // canvas geometry is unchanged and the document still composites cleanly
    const sig2 = await composite(page);
    expect(sig2.w).toBe(sig.w);
    expect(sig2.h).toBe(sig.h);
  });

  test("is wired into the Filter menu", async ({ page }) => {
    await gotoApp(page);
    const ids: string[] = await page.evaluate(() => (window as any).__mv.macMenu.currentActionIds());
    // ids are namespaced by menu path (e.g. "filter/freqsep")
    expect(ids.some((id) => id === "freqsep" || id.endsWith("/freqsep"))).toBe(true);
  });
});
