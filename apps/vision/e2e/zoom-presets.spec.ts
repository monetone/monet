import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Zoom tool presets (100% / Fit Screen / Fill Screen) ──
// Adobe: the Zoom tool options bar has 100% (actual pixels), Fit Screen and Fill
// Screen buttons. Vision adds them, driven by the pure fit/fill ratio math in
// src/state/zoomPresets.ts.
//   https://helpx.adobe.com/photoshop/using/zooming-viewing-image.html

async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(500, 320, "zoom-presets"); // non-square so fit != fill
    mv.engine.commit();
    mv.store.setTool("zoom");
  });
  await expect(page.locator("#mv-zoom-actual")).toBeVisible();
}

const zoom = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.zoom);

test("the zoom tool shows 100% / Fit Screen / Fill Screen buttons", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-zoom-fit")).toBeVisible();
  await expect(page.locator("#mv-zoom-fill")).toBeVisible();
});

test("100% sets the zoom to 1:1", async ({ page }) => {
  await scene(page);
  await page.locator("#mv-zoom-actual").click();
  await expect.poll(() => zoom(page)).toBe(1);
});

test("Fill Screen zooms in more than Fit Screen for a doc smaller than the viewport", async ({ page }) => {
  await scene(page);
  await page.locator("#mv-zoom-fit").click();
  await expect.poll(() => zoom(page)).toBeGreaterThan(0);
  const fit = await zoom(page);
  await page.locator("#mv-zoom-fill").click();
  await expect.poll(() => zoom(page)).toBeGreaterThan(fit);
});
