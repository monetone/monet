import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Hierarchy sort toggle: switch the Scene-panel hierarchy between
// Transform order (render order — depth descending, front-most first) and
// Alphabetical (by name). Editor-only display preference. Specs drive the real
// sort toggle button + assert the rendered row order. Under the `desktop` project
// the last test doubles as the CSP smoke.

/** Hierarchy row names, top-to-bottom as rendered. */
async function hierNames(page: Page): Promise<string[]> {
  const names = await page.locator("[data-obj-id] .mj-item-name").allInnerTexts();
  return names.map((s) => s.trim());
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("toggles the hierarchy between transform and alphabetical order", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addObject("rectangle", { patch: { name: "Banana" } }); // depth 1
    cmd.addObject("rectangle", { patch: { name: "Apple" } });  // depth 2
    cmd.addObject("rectangle", { patch: { name: "Cherry" } }); // depth 3
  });
  // default: transform order = depth descending (newest/front-most first)
  expect(await hierNames(page)).toEqual(["Cherry", "Apple", "Banana"]);

  await page.getByTestId("hierarchy-sort").click(); // → alphabetical
  expect(await hierNames(page)).toEqual(["Apple", "Banana", "Cherry"]);
  expect(await page.evaluate(() => window.__mj.store.state.hierarchySort)).toBe("name");

  await page.getByTestId("hierarchy-sort").click(); // → back to transform
  expect(await hierNames(page)).toEqual(["Cherry", "Apple", "Banana"]);
  expect(await page.evaluate(() => window.__mj.store.state.hierarchySort)).toBe("transform");
});

test("alphabetical sort is case-insensitive and applies within a container", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    const g = cmd.addObject("container", { patch: { name: "Group" } });
    cmd.addObject("rectangle", { parentId: g, patch: { name: "Zebra" } });
    cmd.addObject("rectangle", { parentId: g, patch: { name: "ant" } }); // lowercase sorts with A
  });
  await page.getByTestId("hierarchy-sort").click(); // alphabetical
  const names = await hierNames(page);
  // the container's children are sorted: ant before Zebra (case-insensitive)
  expect(names.indexOf("ant")).toBeLessThan(names.indexOf("Zebra"));
});

test("the sort button starts in transform mode and shows active state when sorting by name", async ({ page }) => {
  expect(await page.evaluate(() => window.__mj.store.state.hierarchySort)).toBe("transform");
  const btn = page.getByTestId("hierarchy-sort");
  await expect(btn).not.toHaveClass(/is-on/);
  await btn.click();
  await expect(btn).toHaveClass(/is-on/);
});

test("hierarchy sort runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addObject("rectangle", { patch: { name: "Beta" } });
    cmd.addObject("rectangle", { patch: { name: "Alpha" } });
  });
  await page.getByTestId("hierarchy-sort").click();
  expect(await hierNames(page)).toEqual(["Alpha", "Beta"]);
  expect(await cspViolations(page)).toEqual([]);
});
