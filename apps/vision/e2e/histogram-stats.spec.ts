import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Histogram panel statistics ───────────────────────────
// Adobe: the Histogram panel shows Mean / Std Dev / Median / Pixels under the
// curve. Vision computes them from the composited image's luminance histogram
// (src/state/histogramStats.ts + EngineClient.lumaHistogram).
//   https://helpx.adobe.com/photoshop/using/histograms-pixel-values.html

/** Fresh 100×100 doc filled with a uniform grey, Histogram tab surfaced. */
async function scene(page: Page, level: number) {
  await gotoApp(page);
  await page.evaluate((g) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "hist");
    const E = mv.engine.engine; // after newDocument: the new doc's active engine
    E.select_all(); E.fill_selection(g, g, g, 255); E.select_none();
    mv.engine.commit();
  }, level);
  await page.locator('[data-tab-id="histogram"]').click(); // surface the Histogram panel
}

test("the Histogram panel shows Mean / Std Dev / Median / Pixels readouts", async ({ page }) => {
  await scene(page, 128);
  await expect(page.locator('[data-mv-hist="mean"]')).toBeVisible();
  await expect(page.locator('[data-mv-hist="stddev"]')).toBeVisible();
  await expect(page.locator('[data-mv-hist="median"]')).toBeVisible();
  await expect(page.locator('[data-mv-hist="pixels"]')).toBeVisible();
});

test("a uniform mid-grey image reports Mean ~128, Std Dev ~0, Pixels = 10000", async ({ page }) => {
  await scene(page, 128);
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("128.00");
  await expect(page.locator('[data-mv-hist="stddev"]')).toContainText("0.00");
  await expect(page.locator('[data-mv-hist="pixels"]')).toContainText("10000");
});
