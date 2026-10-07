import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop History panel ▸ click-to-revert ──────────────────────
// Adobe: clicking a state in the History panel jumps the document to it (revert
// backward or advance forward), with the active state highlighted. Vision's panel
// was display-only; this makes the rows clickable, driven by the engine's true
// undo+redo timeline (history_labels/current/seek). The seek maths is covered by a
// Rust test; this covers the panel rows + that clicking reaches the engine.
//   https://helpx.adobe.com/photoshop/using/undo-history.html

const pix = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => { const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; }, { x, y });
const histIndex = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.historyIndex as number);

async function twoEdits(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "hist");
    const E = mv.engine.engine;
    E.fill_selection(255, 0, 0, 255); mv.engine.commit(); // op 1: red
    E.fill_selection(0, 0, 255, 255); mv.engine.commit(); // op 2: blue
  });
  await page.locator('[data-tab-id="history"]').click(); // surface the History panel
}

test("the History panel shows Open + one row per op, the current state highlighted", async ({ page }) => {
  await twoEdits(page);
  await expect(page.locator('[data-mv-history-row="0"]')).toBeVisible(); // Open
  await expect(page.locator('[data-mv-history-row="1"]')).toBeVisible(); // op 1
  await expect(page.locator('[data-mv-history-row="2"]')).toBeVisible(); // op 2 (current)
  expect(await histIndex(page)).toBe(2);
  await expect(page.locator('[data-mv-history-row="2"]')).toHaveClass(/is-selected/);
});

test("clicking an earlier state reverts the document; clicking forward advances it", async ({ page }) => {
  await twoEdits(page);
  expect((await pix(page, 10, 10)).b).toBeGreaterThan(200); // blue (latest)

  // Click the first op → revert to red, and that row becomes the active one.
  await page.locator('[data-mv-history-row="1"]').click();
  expect(await histIndex(page)).toBe(1);
  const red = await pix(page, 10, 10);
  expect(red.r).toBeGreaterThan(200);
  expect(red.b).toBeLessThan(60);
  await expect(page.locator('[data-mv-history-row="1"]')).toHaveClass(/is-selected/);

  // Click forward to op 2 → blue again (redo path).
  await page.locator('[data-mv-history-row="2"]').click();
  expect((await pix(page, 10, 10)).b).toBeGreaterThan(200);

  // Click Open → the initial (white) state.
  await page.locator('[data-mv-history-row="0"]').click();
  const open = await pix(page, 10, 10);
  expect(open.r).toBeGreaterThan(240);
  expect(open.g).toBeGreaterThan(240);
  expect(open.b).toBeGreaterThan(240);
});
