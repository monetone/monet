import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Color panel spectrum ramp (RGB Spectrum bar) ─────────
// Adobe: the Color panel's bottom ramp picks the foreground colour at the clicked
// position; the RGB Spectrum is a full-saturation rainbow. Vision adds the strip
// driven by the pure mapping in src/state/colorRamp.ts.
//   https://helpx.adobe.com/photoshop/using/choosing-colors.html

const fgHue = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.fg.h);

test("the Color panel shows a spectrum ramp", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator("[data-mv-color-ramp]")).toBeVisible();
});

test("clicking the spectrum ramp sets the foreground hue by position", async ({ page }) => {
  await gotoApp(page);
  const ramp = page.locator("[data-mv-color-ramp]");
  const box = await ramp.boundingBox();
  await ramp.click({ position: { x: 2, y: 8 } }); // far left → red end
  const left = await fgHue(page);
  expect(left).toBeLessThan(20);
  await ramp.click({ position: { x: box!.width / 2, y: 8 } }); // centre → ~cyan (h≈180)
  const mid = await fgHue(page);
  expect(Math.abs(mid - 180)).toBeLessThanOrEqual(8);
  expect(mid).toBeGreaterThan(left);
});
