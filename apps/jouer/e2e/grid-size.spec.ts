import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Grid and Snap "Grid Size": the move-snap + visible-grid increment,
// configurable from View ▸ Grid Size. gridSize is an editor view preference; the
// snap command and the editor grid both read it. Specs drive store.setGridSize +
// cmd.snapSelectionToGrid via window.__mj and assert the snapped model position.
// Under the `desktop` project the last test doubles as the CSP smoke.

const addSelectedAt = (page: Page, x: number, y: number): Promise<string> =>
  page.evaluate(({ x, y }) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x, y });
    store.selectOne(id);
    return id;
  }, { x, y });

const posOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store, query } = window.__mj;
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { x: o.transform.x, y: o.transform.y };
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the grid size defaults to 16", async ({ page }) => {
  expect(await page.evaluate(() => window.__mj.store.state.gridSize)).toBe(16);
});

test("setting the grid size to 32 snaps the selection to a 32-grid", async ({ page }) => {
  const id = await addSelectedAt(page, 100, 100);
  await page.evaluate(() => window.__mj.store.setGridSize(32));
  await page.evaluate(() => window.__mj.cmd.snapSelectionToGrid());
  expect(await posOf(page, id)).toEqual({ x: 96, y: 96 }); // round(100/32)=3 → 96
});

test("a finer grid size of 8 snaps to an 8-grid", async ({ page }) => {
  const id = await addSelectedAt(page, 102, 102);
  await page.evaluate(() => window.__mj.store.setGridSize(8));
  await page.evaluate(() => window.__mj.cmd.snapSelectionToGrid());
  expect(await posOf(page, id)).toEqual({ x: 104, y: 104 }); // round(102/8)=13 → 104
});

test("setGridSize clamps to a minimum of 1", async ({ page }) => {
  await page.evaluate(() => window.__mj.store.setGridSize(0));
  expect(await page.evaluate(() => window.__mj.store.state.gridSize)).toBe(1);
});

test("grid size runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await addSelectedAt(page, 100, 100);
  await page.evaluate(() => window.__mj.store.setGridSize(32));
  await page.evaluate(() => window.__mj.cmd.snapSelectionToGrid());
  expect((await posOf(page, id)).x).toBe(96);
  expect(await cspViolations(page)).toEqual([]);
});
