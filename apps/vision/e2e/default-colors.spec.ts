import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop D key → default colours ──────────────────────────────
// Adobe: D resets to black foreground / white background, inverted (white / black)
// while a mask is the active edit target. Driven by the pure defaultColors helper
// in src/state/defaultColors.ts.
//   https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html

const colors = (page: Page): Promise<{ fg: any; bg: any }> =>
  page.evaluate(() => { const s = (window as any).__mv.store.state; return { fg: s.fg, bg: s.bg }; });

const BLACK = { h: 0, s: 0, v: 0, a: 1 };
const WHITE = { h: 0, s: 0, v: 1, a: 1 };

test("D sets black foreground / white background", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setForeground({ h: 120, s: 1, v: 1, a: 1 }); mv.store.setBackground({ h: 200, s: 1, v: 0.5, a: 1 }); });
  await page.keyboard.press("d");
  const c = await colors(page);
  expect(c.fg).toEqual(BLACK);
  expect(c.bg).toEqual(WHITE);
});

test("D inverts to white foreground / black background while editing a mask", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setOptions({ maskEdit: true }); mv.store.setForeground({ h: 120, s: 1, v: 1, a: 1 }); });
  await page.keyboard.press("d");
  const c = await colors(page);
  expect(c.fg).toEqual(WHITE);
  expect(c.bg).toEqual(BLACK);
});
