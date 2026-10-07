import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Info panel HSB + Hex (Web) readouts ──────────────────
// Adobe: the Info panel reports the colour under the pointer in multiple models
// (RGB, HSB, Web/Hex, …). Vision adds H/S/B + Hex rows from the picked colour via
// the pure rgbToHsb in src/state/rgbHsb.ts + the existing colorHexCode.
//   https://helpx.adobe.com/photoshop/using/information-panel-overview.html

const val = (page: Page, id: string) => page.locator(`[data-mv-info="${id}"] .val`);

/** Surface the Info tab with a known picked colour. */
async function pick(page: Page, r: number, g: number, b: number) {
  await page.evaluate(({ r, g, b }) => (window as any).__mv.store.setPicked({ r, g, b, a: 255 }), { r, g, b });
}

test("the Info panel shows HSB + Hex readouts for the picked colour", async ({ page }) => {
  await gotoApp(page);
  await pick(page, 255, 0, 0);
  await page.locator('[data-tab-id="info"]').click();
  await expect(val(page, "h")).toHaveText("0°");
  await expect(val(page, "s")).toHaveText("100%");
  await expect(val(page, "b")).toHaveText("100%");
  await expect(val(page, "hex")).toHaveText("ff0000");
});

test("the HSB readout tracks the picked hue", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-tab-id="info"]').click();
  await pick(page, 0, 255, 0);
  await expect(val(page, "h")).toHaveText("120°");
  await expect(val(page, "hex")).toHaveText("00ff00");
});
