import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop brush size/hardness keyboard shortcuts ───────────────
// Adobe: [ / ] resize the brush; { / } (Shift+[ / Shift+]) change its hardness.
// Vision already had [ / ] for size; this adds { / } for hardness, both backed by
// the pure step helpers in src/state/brushShortcuts.ts.
//   https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html

const brush = (page: Page): Promise<{ size: number; hardness: number }> =>
  page.evaluate(() => { const b = (window as any).__mv.store.state.brush; return { size: b.size, hardness: b.hardness }; });

/** Boot with a known brush (size 50, hardness 0.5). */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setBrush({ size: 50, hardness: 0.5 }));
}

test("[ and ] step the brush size", async ({ page }) => {
  await scene(page);
  await page.keyboard.press("BracketRight");
  expect((await brush(page)).size).toBe(52);
  await page.keyboard.press("BracketLeft");
  expect((await brush(page)).size).toBe(50);
});

test("{ and } step the brush hardness", async ({ page }) => {
  await scene(page);
  await page.keyboard.press("Shift+BracketRight"); // }
  expect((await brush(page)).hardness).toBe(0.75);
  await page.keyboard.press("Shift+BracketLeft"); // {
  expect((await brush(page)).hardness).toBe(0.5);
});
