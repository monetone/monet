import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop "Filter for layer color" ─────────────────────────────
// Adobe: the Layers-panel filter bar can narrow the list to layers tagged with a
// given colour label (multi-select swatches). Vision adds a colour-swatch row to
// the open Find-Layers row that ANDs with the kind + name filters.
//   https://helpx.adobe.com/photoshop/using/selecting-grouping-linking-layers.html

// Three layers; label two (red/blue), leave one unlabelled, open the filter row.
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "colorfilter");
    mv.store.addLayer();
    mv.store.addLayer();
    const ids = mv.store.state.layers.map((l: any) => l.id);
    mv.store.setLayerColorLabel(ids[0], "red");
    mv.store.setLayerColorLabel(ids[1], "blue");
    if (!mv.store.state.layerFilterOpen) mv.store.toggleLayerFilter();
  });
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("3/3");
}

test("selecting colours narrows the list (multi-select, then clear)", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.store.toggleLayerColorFilter("red"));
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("1/3");
  await expect(page.locator('[role="option"]')).toHaveCount(1);

  await page.evaluate(() => (window as any).__mv.store.toggleLayerColorFilter("blue"));
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("2/3");

  await page.evaluate(() => { const s = (window as any).__mv.store; s.toggleLayerColorFilter("red"); s.toggleLayerColorFilter("blue"); });
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("3/3");
});

test("clicking a colour swatch presses it and filters the list", async ({ page }) => {
  await scene(page);
  const blue = page.locator('[data-mv-color-filter-btn="blue"]');
  await expect(blue).toHaveAttribute("aria-pressed", "false");
  await blue.click();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("1/3");
});
