import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop editable status-bar zoom field ───────────────────────
// Adobe: the status bar's zoom percentage is editable — type a value + Enter to
// set the zoom. Vision adds the field driven by the pure parseZoomField helper.
//   https://helpx.adobe.com/photoshop/using/adjusting-image-views.html

const zoomOf = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.zoom);

async function setField(page: Page, v: string) {
  await page.locator("#mv-status-zoom").fill(v);
  await page.locator("#mv-status-zoom").press("Enter");
}

test("typing a percentage sets the zoom", async ({ page }) => {
  await gotoApp(page);
  await setField(page, "200");
  expect(await zoomOf(page)).toBe(2);
  await setField(page, "50");
  expect(await zoomOf(page)).toBe(0.5);
});

test("clamps out-of-range and ignores invalid input", async ({ page }) => {
  await gotoApp(page);
  await setField(page, "5000");
  expect(await zoomOf(page)).toBe(32); // clamped to 3200%
  await setField(page, "100");
  expect(await zoomOf(page)).toBe(1);
  await setField(page, "abc");
  expect(await zoomOf(page)).toBe(1); // invalid → unchanged
});
