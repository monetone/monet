import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Color panel ramp modes ───────────────────────────────
// Adobe: the Color panel ramp flyout selects the ramp type (RGB Spectrum,
// Grayscale Ramp, Current Colors). Vision adds Grayscale + Current Colors atop the
// spectrum (iteration 32), driven by the pure rampColor in src/state/colorRamp.ts.
//   https://helpx.adobe.com/photoshop/using/color-panel-overview.html

const fg = (page: Page): Promise<{ h: number; s: number; v: number }> =>
  page.evaluate(() => { const c = (window as any).__mv.store.state.fg; return { h: c.h, s: c.s, v: c.v }; });

test("the ramp mode selector defaults to Spectrum", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator("#mv-ramp-mode")).toBeVisible();
  await expect(page.locator("#mv-ramp-mode")).toHaveAttribute("data-value", "spectrum");
});

test("Grayscale mode picks a gray from the ramp position", async ({ page }) => {
  await gotoApp(page);
  await chooseOption(page.locator("#mv-ramp-mode"), "grayscale");
  const ramp = page.locator("[data-mv-color-ramp]");
  const box = await ramp.boundingBox();
  await ramp.click({ position: { x: box!.width / 2, y: 8 } }); // centre → mid-gray
  const c = await fg(page);
  expect(c.s).toBe(0);
  expect(c.v).toBeGreaterThan(0.4);
  expect(c.v).toBeLessThan(0.6);
});

test("Current Colors mode lerps foreground→background", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue
  });
  await chooseOption(page.locator("#mv-ramp-mode"), "current");
  const ramp = page.locator("[data-mv-color-ramp]");
  const box = await ramp.boundingBox();
  await ramp.click({ position: { x: box!.width - 2, y: 8 } }); // far right → near background (blue)
  expect((await fg(page)).h).toBeGreaterThan(220);
});
