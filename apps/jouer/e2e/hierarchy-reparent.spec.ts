import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Hierarchy drag-to-reparent: drag an object onto a container to make
// it a child, or onto the list background to move it to the scene root. The reparent
// command (cycle-safe) is the tested core; an e2e also drives the real drag-drop.
// Under the `desktop` project the last test doubles as the CSP smoke.

const parentIdOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store, query } = window.__mj;
    const scene = query.activeScene(store.getProject());
    return query.findParent(scene, id)?.id ?? null;
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("cmd.reparent moves an object into a container and back to the root", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const container = cmd.addObject("container");
    const sprite = cmd.addObject("sprite");
    return { container, sprite };
  });
  await page.evaluate((ids) => window.__mj.cmd.reparent(ids.sprite, ids.container), ids);
  expect(await parentIdOf(page, ids.sprite)).toBe(ids.container); // now a child
  await page.evaluate((ids) => window.__mj.cmd.reparent(ids.sprite, null), ids);
  expect(await parentIdOf(page, ids.sprite)).toBeNull(); // back to root
});

test("cmd.reparent refuses a cycle (reparenting a container into its own descendant)", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const outer = cmd.addObject("container");
    const inner = cmd.addObject("container");
    cmd.reparent(inner, outer); // inner is now a child of outer
    cmd.reparent(outer, inner); // illegal: outer into its own descendant → no-op
    return { outer, inner };
  });
  expect(await parentIdOf(page, ids.outer)).toBeNull(); // outer stayed at root
  expect(await parentIdOf(page, ids.inner)).toBe(ids.outer); // inner stayed under outer
});

test("dragging a sprite row onto a container row reparents it", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const container = cmd.addObject("container");
    const sprite = cmd.addObject("sprite");
    return { container, sprite };
  });
  await page.locator(`[data-obj-id="${ids.sprite}"]`).dragTo(page.locator(`[data-obj-id="${ids.container}"]`));
  await expect.poll(() => parentIdOf(page, ids.sprite)).toBe(ids.container);
});

test("hierarchy reparent runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const container = cmd.addObject("container");
    const sprite = cmd.addObject("sprite");
    cmd.reparent(sprite, container);
    return { container, sprite };
  });
  expect(await parentIdOf(page, ids.sprite)).toBe(ids.container);
  expect(await cspViolations(page)).toEqual([]);
});
