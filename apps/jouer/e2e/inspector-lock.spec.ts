import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Inspector padlock: a locked Inspector stays pinned to one object
// regardless of the current selection; deleting that object unpins it. The
// ObjectInspector root carries data-obj (distinct from the hierarchy rows'
// data-obj-id) so specs can read which object is shown. Under the `desktop`
// project the last test doubles as the CSP smoke.

const select = (page: Page, id: string) => page.evaluate((id) => window.__mj.store.selectOne(id), id);
const lockedId = (page: Page) => page.evaluate(() => window.__mj.store.lockedInspectorId);
const shown = (page: Page) => page.locator('[data-testid="object-inspector"]');

/** Two rectangles A, B. */
async function seed(page: Page) {
  return page.evaluate(() => {
    const { cmd } = window.__mj;
    return { a: cmd.addObject("rectangle", { patch: { name: "A" } }), b: cmd.addObject("rectangle", { patch: { name: "B" } }) } as Record<string, string>;
  });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a locked inspector stays pinned to its object while the selection changes", async ({ page }) => {
  const ids = await seed(page);
  await select(page, ids.a);
  await expect(shown(page)).toHaveAttribute("data-obj", ids.a);
  await page.getByTestId("inspector-lock").click(); // lock to A
  expect(await lockedId(page)).toBe(ids.a);

  await select(page, ids.b); // selection moves to B…
  await expect(shown(page)).toHaveAttribute("data-obj", ids.a); // …inspector stays on A
});

test("unlocking makes the inspector follow the selection again", async ({ page }) => {
  const ids = await seed(page);
  await select(page, ids.a);
  await page.getByTestId("inspector-lock").click(); // lock A
  await select(page, ids.b);
  await expect(shown(page)).toHaveAttribute("data-obj", ids.a);
  // The lock button (shown on the pinned A) toggles the lock off.
  await page.getByTestId("inspector-lock").click();
  expect(await lockedId(page)).toBeNull();
  await expect(shown(page)).toHaveAttribute("data-obj", ids.b); // now follows the B selection
});

test("deleting a locked object unpins the inspector", async ({ page }) => {
  const ids = await seed(page);
  await select(page, ids.a);
  await page.getByTestId("inspector-lock").click(); // lock A
  await select(page, ids.b); // inspector still on A
  await expect(shown(page)).toHaveAttribute("data-obj", ids.a);
  // Delete the locked object A.
  await page.evaluate((id) => { window.__mj.store.selectOne(id); window.__mj.cmd.deleteSelection(); }, ids.a);
  expect(await lockedId(page)).toBeNull(); // lock cleared
  // Inspector now follows the selection (re-select B to confirm it is free).
  await select(page, ids.b);
  await expect(shown(page)).toHaveAttribute("data-obj", ids.b);
});

test("inspector lock runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const ids = await seed(page);
  await select(page, ids.a);
  await page.getByTestId("inspector-lock").click();
  await select(page, ids.b);
  await expect(shown(page)).toHaveAttribute("data-obj", ids.a);
  expect(await cspViolations(page)).toEqual([]);
});
