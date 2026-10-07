import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Info panel CMYK readout (RGB/Gray docs) ──────────────
// Adobe: the Info panel shows a CMYK readout for the picked colour even in RGB/
// Grayscale documents (converted via the working CMYK space — the print-check
// case). Vision adds C/M/Y/K rows from the pure naive sRGB→CMYK in
// src/state/rgbCmyk.ts (the engine pick_cmyk path still serves CMYK docs).
//   https://helpx.adobe.com/photoshop/using/information-panel-overview.html

const val = (page: Page, id: string) => page.locator(`[data-mv-info="${id}"] .val`);
const pick = (page: Page, r: number, g: number, b: number) =>
  page.evaluate(({ r, g, b }) => (window as any).__mv.store.setPicked({ r, g, b, a: 255 }), { r, g, b });

test("the Info panel shows a CMYK readout for the picked colour in an RGB doc", async ({ page }) => {
  await gotoApp(page);
  await pick(page, 255, 0, 0);
  await page.locator('[data-tab-id="info"]').click();
  await expect(val(page, "cmyk-c")).toHaveText("0%");
  await expect(val(page, "cmyk-m")).toHaveText("100%");
  await expect(val(page, "cmyk-y")).toHaveText("100%");
  await expect(val(page, "cmyk-k")).toHaveText("0%");
});

test("white reads as no ink", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-tab-id="info"]').click();
  await pick(page, 255, 255, 255);
  await expect(val(page, "cmyk-c")).toHaveText("0%");
  await expect(val(page, "cmyk-m")).toHaveText("0%");
  await expect(val(page, "cmyk-y")).toHaveText("0%");
  await expect(val(page, "cmyk-k")).toHaveText("0%");
});
