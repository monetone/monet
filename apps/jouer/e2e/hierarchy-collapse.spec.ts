import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Hierarchy expand/collapse: the per-row twirl collapses a single
// container, and the toolbar's Collapse All / Expand All act on the whole tree.
// A collapsed container's child rows are removed from the DOM; an active search
// force-opens it so matches stay reachable. Under the `desktop` project the last
// test doubles as the CSP smoke.

const rowCount = (page: Page, id: string) => page.locator(`[data-obj-id="${id}"]`).count();

/** A container `c` holding two rectangles `a`, `b`. */
async function seed(page: Page) {
  return page.evaluate(() => {
    const { cmd } = window.__mj;
    const c = cmd.addObject("container", { patch: { name: "Group" } });
    const a = cmd.addObject("rectangle", { parentId: c, patch: { name: "Alpha" } });
    const b = cmd.addObject("rectangle", { parentId: c, patch: { name: "Beta" } });
    return { c, a, b } as Record<string, string>;
  });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("Collapse All hides child rows; Expand All shows them again", async ({ page }) => {
  const ids = await seed(page);
  expect(await rowCount(page, ids.a)).toBe(1); // children visible initially
  expect(await rowCount(page, ids.b)).toBe(1);

  await page.getByTestId("hierarchy-collapse-all").click();
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-obj-id="${ids.b}"]`)).toHaveCount(0);
  expect(await rowCount(page, ids.c)).toBe(1); // the container row itself stays

  await page.getByTestId("hierarchy-expand-all").click();
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-obj-id="${ids.b}"]`)).toHaveCount(1);
});

test("the per-row twirl collapses and expands a single container", async ({ page }) => {
  const ids = await seed(page);
  const twirl = page.locator(`[data-obj-id="${ids.c}"] [data-testid="row-twirl"]`);
  await twirl.click();
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(0);
  await twirl.click();
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(1);
});

test("an active search force-opens a collapsed container", async ({ page }) => {
  const ids = await seed(page);
  await page.getByTestId("hierarchy-collapse-all").click();
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(0);
  // Searching for a child reveals it even though its container is collapsed.
  await page.getByTestId("hierarchy-search").fill("Alpha");
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(1);
  // Clearing the search re-hides it (the container is still collapsed).
  await page.getByTestId("hierarchy-search").fill("");
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(0);
});

test("collapse state resets when switching scenes", async ({ page }) => {
  const ids = await seed(page);
  await page.getByTestId("hierarchy-collapse-all").click();
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(0);
  // A fresh scene + back: collapse state is per-scene editor view state.
  await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const first = store.getProject().activeSceneId;
    const second = cmd.addScene();
    store.setActiveScene(second);
    store.setActiveScene(first);
  });
  await expect(page.locator(`[data-obj-id="${ids.a}"]`)).toHaveCount(1);
});

test("hierarchy collapse runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const ids = await seed(page);
  await page.getByTestId("hierarchy-collapse-all").click();
  await page.getByTestId("hierarchy-expand-all").click();
  expect(await rowCount(page, ids.a)).toBe(1);
  expect(await cspViolations(page)).toEqual([]);
});
