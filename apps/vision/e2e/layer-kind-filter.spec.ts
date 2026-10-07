import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Layers panel kind + attribute filters ────────────────
// Adobe: the Layers panel filter row starts with a Kind filter (Pixel / Adjustment
// / Type / Shape / Smart Object) and can filter by layer attributes. Vision drives
// both dropdowns with the pure predicates in src/state/layerKindFilter.ts.
//   https://helpx.adobe.com/photoshop/using/selecting-grouping-linking-layers.html

/** Doc with 2 pixel layers + 1 hidden Invert adjustment layer; the Find-Layers row open. */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "kinds"); // base pixel layer (kind 0)
    mv.store.addLayer(); // 2nd pixel layer (kind 0)
    mv.store.addAdjustmentLayer(4, new Float32Array(0), "Invert"); // adjustment layer (kind 1)
    mv.store.setLayerVisible(mv.store.state.activeLayerId, false);
    mv.store.toggleLayerFilter(); // open the Find-Layers row
  });
  await expect(page.locator("#mv-layer-kind")).toBeVisible();
  await expect(page.locator("#mv-layer-attribute")).toBeVisible();
}

const count = (page: Page) => page.locator("[data-mv-layer-count]");

test("the Find-Layers row shows Kind and Attribute selectors and the shown/total count", async ({ page }) => {
  await scene(page);
  expect(await page.locator("#mv-layer-kind").getAttribute("data-value")).toBe("all");
  expect(await page.locator("#mv-layer-attribute").getAttribute("data-value")).toBe("all");
  await expect(count(page)).toHaveText("3/3");
});

test("the Kind filter narrows the layer list by type", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-layer-kind"), "adjustment");
  await expect(count(page)).toHaveText("1/3");
  await chooseOption(page.locator("#mv-layer-kind"), "pixel");
  await expect(count(page)).toHaveText("2/3");
  await chooseOption(page.locator("#mv-layer-kind"), "all");
  await expect(count(page)).toHaveText("3/3");
});

test("the Attribute filter narrows the layer list by layer state", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-layer-attribute"), "hidden");
  await expect(count(page)).toHaveText("1/3");
  await chooseOption(page.locator("#mv-layer-attribute"), "visible");
  await expect(count(page)).toHaveText("2/3");
  await chooseOption(page.locator("#mv-layer-attribute"), "all");
  await expect(count(page)).toHaveText("3/3");
});
