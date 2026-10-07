import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Histogram panel Channel selector ─────────────────────
// Adobe: the Histogram panel's Channel menu (RGB/Red/Green/Blue/Luminosity) selects
// which channel the curve + statistics describe. Vision adds Luminance/Red/Green/
// Blue, driven by the pure per-channel histogram in src/state/channelHistogram.ts.
//   https://helpx.adobe.com/photoshop/using/histograms-pixel-values.html

/** Fresh 100×100 solid-red doc, Histogram tab surfaced. */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "histch");
    const E = mv.engine.engine; // after newDocument: the new doc's active engine
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="histogram"]').click();
}

/** Open the Channel dropdown, assert its options contain `labels` in order, close it. */
async function expectChannels(page: Page, labels: string[]) {
  await page.locator("#mv-hist-channel").click();
  await expect(page.locator(".monet-listbox [role=option]")).toContainText(labels);
  await page.locator("#mv-hist-channel").click();
}

test("the Histogram panel shows a Channel dropdown defaulting to Luminance", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-hist-channel")).toBeVisible();
  await expect(page.locator("#mv-hist-channel")).toHaveAttribute("data-value", "luma");
});

test("the Channel selector recomputes the stats per channel (solid red)", async ({ page }) => {
  await scene(page);
  // Luminance of pure red = round(0.299*255) = 76
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("76");
  await chooseOption(page.locator("#mv-hist-channel"), "r");
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("255.00");
  await chooseOption(page.locator("#mv-hist-channel"), "g");
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("0.00");
});

test("the Channel selector follows Lab and Multichannel document modes", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setColorMode(3));
  await expect(page.locator("#mv-hist-channel")).toHaveAttribute("data-value", "lab-l");
  await expectChannels(page, ["Lightness", "a", "b"]);
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("138.00"); // L 54 (D50 Lab, #459)
  await chooseOption(page.locator("#mv-hist-channel"), "lab-a");
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("209.00");

  await page.evaluate(() => (window as any).__mv.store.setColorMode(4));
  await expect(page.locator("#mv-hist-channel")).toHaveAttribute("data-value", "c");
  await expectChannels(page, ["Cyan", "Magenta", "Yellow", "Black"]);
  await chooseOption(page.locator("#mv-hist-channel"), "m");
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("255.00");
});
