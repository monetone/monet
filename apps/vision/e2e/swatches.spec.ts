import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Swatches panel ───────────────────────────────────────
// Window ▸ Swatches: a grid of saved colours. Click a swatch to set it as the
// foreground; "+ Add" saves the current foreground; Alt-click removes one.
// Pure list helpers live in src/state/swatches.ts.
//   https://helpx.adobe.com/photoshop/using/choosing-colors.html

/** Surface the Swatches panel (a tab in the colour group). */
async function showSwatches(page: Page) {
  await gotoApp(page);
  await page.locator('[data-tab-id="swatches"]').click();
  await expect(page.locator("[data-mv-swatches]")).toBeVisible();
}

const count = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.swatches.length);

/** store.fg (HSV 0..360/0..1) → [r,g,b] 0..255, matching monet-react hsvToRgb. */
const fgRgb = (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const { h, s, v } = (window as any).__mv.store.state.fg;
    const c = v * s;
    const hp = ((((h % 360) + 360) % 360)) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = v - c;
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  });

test("'+ Add' saves the foreground colour as a new swatch", async ({ page }) => {
  await showSwatches(page);
  await page.evaluate(() => (window as any).__mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 })); // red → #ff0000 (not a default)
  const before = await count(page);
  await page.getByRole("button", { name: "+ Add" }).click();
  expect(await count(page)).toBe(before + 1);
  await expect(page.locator('[data-mv-swatch="#ff0000"]')).toHaveCount(1);
});

test("clicking a swatch sets it as the foreground", async ({ page }) => {
  await showSwatches(page);
  await page.locator('[data-mv-swatch="#007aff"]').click(); // a default blue
  const [r, g, b] = await fgRgb(page);
  expect(Math.abs(r - 0)).toBeLessThanOrEqual(2);
  expect(Math.abs(g - 122)).toBeLessThanOrEqual(2);
  expect(Math.abs(b - 255)).toBeLessThanOrEqual(2);
});

test("Alt-clicking a swatch removes it", async ({ page }) => {
  await showSwatches(page);
  const before = await count(page);
  await page.locator('[data-mv-swatch="#34c759"]').click({ modifiers: ["Alt"] });
  expect(await count(page)).toBe(before - 1);
  await expect(page.locator('[data-mv-swatch="#34c759"]')).toHaveCount(0);
});

test("the exact swatch library persists across reloads, including an empty library", async ({ page }) => {
  await showSwatches(page);
  const expected = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.addSwatch("#123456");
    mv.store.removeSwatch(mv.store.state.swatches.indexOf("#34c759"));
    return [...mv.store.state.swatches] as string[];
  });

  await showSwatches(page);
  expect(await page.evaluate(() => (window as any).__mv.store.state.swatches)).toEqual(expected);
  await expect(page.locator('[data-mv-swatch="#123456"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-swatch="#34c759"]')).toHaveCount(0);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    for (let i = mv.store.state.swatches.length - 1; i >= 0; i--) mv.store.removeSwatch(i);
  });
  await gotoApp(page);
  await page.locator('[data-tab-id="swatches"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.swatches)).toEqual([]);
  await expect(page.locator("[data-mv-swatches]")).toHaveAttribute("data-mv-swatches", "0");
  await expect(page.getByRole("button", { name: "+ Add" })).toBeVisible();
});
