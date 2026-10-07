import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Histogram panel "All Channels View" ──────────────────
// Adobe: the Histogram panel flyout's All Channels View shows the Red, Green and
// Blue histograms together. Vision adds an "All Channels" toggle backed by the
// pure allChannelBars helper (composing channelCounts + downsampleBins).
//   https://helpx.adobe.com/photoshop/using/histograms-pixel-values.html

/** Fresh 100×100 solid-red doc, Histogram tab surfaced. */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "histall");
    const E = mv.engine.engine; // after newDocument: the new doc's active engine
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="histogram"]').click();
}

test("the Histogram panel shows an All Channels toggle", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-hist-all")).toBeVisible();
  await expect(page.locator('[data-mv-hist="mean"]')).toHaveCount(1); // single-channel stats by default
  await expect(page.locator("[data-mv-allchan]")).toHaveCount(0);
});

test("All Channels renders R/G/B histograms and hides the single-channel stats", async ({ page }) => {
  await scene(page);
  await page.locator("#mv-hist-all").check();
  await expect(page.locator('[data-mv-allchan="r"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-allchan="g"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-allchan="b"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-hist="mean"]')).toHaveCount(0);
  await page.locator("#mv-hist-all").uncheck();
  await expect(page.locator("[data-mv-allchan]")).toHaveCount(0);
  await expect(page.locator('[data-mv-hist="mean"]')).toHaveCount(1);
});

test("All Channels follows Lab document channels", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setColorMode(3));
  await page.locator("#mv-hist-all").check();
  await expect(page.locator('[data-mv-allchan="lab-l"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-allchan="lab-a"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-allchan="lab-b"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-allchan="r"]')).toHaveCount(0);
});
