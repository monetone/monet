import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop layer color labels ───────────────────────────────────
// Adobe: a layer can be tagged with a colour label (Red/Orange/…/No Color) via the
// layer's right-click menu; the colour shows on the row. Vision drives the row chip
// + a thumbnail dot from the pure layerLabels module + a per-id store map.
//   https://helpx.adobe.com/photoshop/using/selecting-grouping-linking-layers.html

const labelOf = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => { const mv = (window as any).__mv; return mv.store.state.layerColorLabels[mv.store.state.activeLayerId]; });

async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(100, 100, "labels"));
}

test("a color label tags the layer row and clears with No Color", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setLayerColorLabel(mv.store.state.activeLayerId, "red"); });
  await expect(page.locator('[data-mv-layer-label="red"]')).toHaveCount(1);
  expect(await labelOf(page)).toBe("red");
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setLayerColorLabel(mv.store.state.activeLayerId, "none"); });
  await expect(page.locator("[data-mv-layer-label]")).toHaveCount(0);
  expect(await labelOf(page)).toBeUndefined();
});

test("the layer context menu offers a Color Label submenu", async ({ page }) => {
  await scene(page);
  await page.locator('[role="option"]').first().click({ button: "right" });
  await expect(page.getByText("Color Label", { exact: true })).toBeVisible();
});
