import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Hierarchy search (Unity's Hierarchy window search bar): filter the
// scene object tree by name (case-insensitive substring) and by type with the
// `t:<kind>` prefix. Editor-session state — not in the .jouer document. These
// specs drive the real panel DOM through `[data-obj-id]` rows + `window.__mj`;
// under the `desktop` project (shipped bundle + Tauri CSP) the last test doubles
// as the CSP smoke.

/** Sorted names of the object rows currently rendered in the Hierarchy tree. */
async function hierNames(page: Page): Promise<string[]> {
  const names = await page.locator("[data-obj-id] .mj-item-name").allInnerTexts();
  return names.map((s) => s.trim()).sort();
}

/** Whether a given object's row carries the search-hit highlight class. */
async function isMatch(page: Page, id: string): Promise<boolean> {
  const cls = (await page.locator(`[data-obj-id="${id}"]`).first().getAttribute("class")) ?? "";
  return cls.split(/\s+/).includes("is-match");
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("filters the hierarchy by name and restores on clear", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd } = window.__mj;
    return {
      player: cmd.addObject("rectangle", { patch: { name: "Player" } }),
      enemyA: cmd.addObject("ellipse", { patch: { name: "Enemy A" } }),
      enemyB: cmd.addObject("ellipse", { patch: { name: "Enemy B" } }),
    };
  });

  // Unfiltered: all three rows present.
  await expect(page.locator("[data-obj-id]")).toHaveCount(3);

  await page.fill('[data-testid="hierarchy-search"]', "enemy");
  await expect(page.locator("[data-obj-id]")).toHaveCount(2);
  expect(await hierNames(page)).toEqual(["Enemy A", "Enemy B"]);
  // Matched rows are highlighted; the non-match is gone.
  expect(await isMatch(page, ids.enemyA)).toBe(true);
  await expect(page.locator(`[data-obj-id="${ids.player}"]`)).toHaveCount(0);
  // Count chip reflects the number of matches.
  await expect(page.getByTestId("hierarchy-count")).toHaveText("2 matches");

  // Clearing via the × button restores the full tree.
  await page.click('[data-testid="hierarchy-clear"]');
  await expect(page.locator("[data-obj-id]")).toHaveCount(3);
  expect(await page.evaluate(() => window.__mj.store.state.hierarchyFilter)).toBe("");
});

test("filters by type with the t: prefix", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addObject("rectangle", { patch: { name: "Wall" } });
    cmd.addObject("ellipse", { patch: { name: "Sun" } });
    cmd.addObject("ellipse", { patch: { name: "Moon" } });
    cmd.addObject("text", { patch: { name: "Title" } });
  });

  await page.fill('[data-testid="hierarchy-search"]', "t:ellipse");
  await expect(page.locator("[data-obj-id]")).toHaveCount(2);
  expect(await hierNames(page)).toEqual(["Moon", "Sun"]);

  // Abbreviation parity: `t:txt` resolves to the text kind.
  await page.fill('[data-testid="hierarchy-search"]', "t:txt");
  expect(await hierNames(page)).toEqual(["Title"]);

  // An unknown type matches nothing.
  await page.fill('[data-testid="hierarchy-search"]', "t:bogus");
  await expect(page.locator("[data-obj-id]")).toHaveCount(0);
  await expect(page.getByTestId("hierarchy-count")).toHaveText("No matches");
});

test("a nested match keeps its container row visible as the path", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const group = cmd.addObject("container", { patch: { name: "Spawner" } });
    const goblin = cmd.addObject("text", { parentId: group, patch: { name: "Goblin" } });
    const player = cmd.addObject("rectangle", { patch: { name: "Player" } });
    return { group, goblin, player };
  });

  await page.fill('[data-testid="hierarchy-search"]', "goblin");
  // The nested text matches; its container comes along as the visible ancestor.
  expect(await hierNames(page)).toEqual(["Goblin", "Spawner"]);
  await expect(page.locator(`[data-obj-id="${ids.player}"]`)).toHaveCount(0);
  // Only the actual match is highlighted, not the ancestor container.
  expect(await isMatch(page, ids.goblin)).toBe(true);
  expect(await isMatch(page, ids.group)).toBe(false);
});

test("cmd.setHierarchyFilter drives the panel and input", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addObject("rectangle", { patch: { name: "Alpha" } });
    cmd.addObject("rectangle", { patch: { name: "Beta" } });
  });

  await page.evaluate(() => window.__mj.cmd.setHierarchyFilter("alpha"));
  await expect(page.locator("[data-obj-id]")).toHaveCount(1);
  expect(await hierNames(page)).toEqual(["Alpha"]);
  await expect(page.getByTestId("hierarchy-search")).toHaveValue("alpha");

  await page.evaluate(() => window.__mj.cmd.clearHierarchyFilter());
  await expect(page.locator("[data-obj-id]")).toHaveCount(2);
  await expect(page.getByTestId("hierarchy-search")).toHaveValue("");
});

test("search runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addObject("rectangle", { patch: { name: "Hero" } });
    cmd.addObject("ellipse", { patch: { name: "Villain" } });
    cmd.setHierarchyFilter("hero");
    cmd.setHierarchyFilter("t:ellipse");
    cmd.clearHierarchyFilter();
  });
  await expect(page.locator("[data-obj-id]")).toHaveCount(2);
  expect(await cspViolations(page)).toEqual([]);
});
