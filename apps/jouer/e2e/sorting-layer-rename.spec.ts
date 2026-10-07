import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Sorting Layer rename (Tags & Layers → Sorting Layers): renaming a
// layer keeps its index (render order) and cascades to every object that was on
// it. The command is driven through window.__mj; the inline-rename UI lives in the
// SceneInspector's Sorting Layers section. Under the `desktop` project the last
// test doubles as the CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("renaming a layer keeps its index and cascades to member objects", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.addSortingLayer("Foreground"); // [Default, Foreground]
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.setSortingLayer(id, "Foreground");
    const before = store.getProject().sortingLayers.indexOf("Foreground");
    cmd.renameSortingLayer("Foreground", "FG");
    const p = store.getProject();
    return { before, after: p.sortingLayers.indexOf("FG"), layers: p.sortingLayers, layer: query.findObject(query.activeScene(p), id).sortingLayer };
  });
  expect(r.layers).not.toContain("Foreground");
  expect(r.layers).toContain("FG");
  expect(r.after).toBe(r.before); // in-place: same index → render order unchanged
  expect(r.layer).toBe("FG"); // cascaded to the member object
});

test("renaming the Default layer is a no-op", async ({ page }) => {
  const layers = await page.evaluate(() => {
    window.__mj.cmd.renameSortingLayer("Default", "Base");
    return window.__mj.store.getProject().sortingLayers;
  });
  expect(layers).toContain("Default");
  expect(layers).not.toContain("Base");
});

test("renaming to an existing layer name is a no-op (no merge)", async ({ page }) => {
  const layers = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addSortingLayer("A");
    cmd.addSortingLayer("B");
    cmd.renameSortingLayer("A", "B"); // collision → no-op
    return store.getProject().sortingLayers;
  });
  expect(layers).toContain("A");
  expect(layers).toContain("B");
});

test("double-clicking a custom layer renames it inline (cascades to a member object)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addSortingLayer("Foreground");
    const o = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.setSortingLayer(o, "Foreground");
    cmd.deselectAll(); // show the SceneInspector (Sorting Layers section)
    return o;
  });
  await page.locator('[data-sorting-layer="Foreground"] span').dblclick();
  const input = page.getByTestId("sorting-layer-rename");
  await input.fill("FG");
  await input.press("Enter");
  const r = await page.evaluate((id) => {
    const { store, query } = window.__mj;
    const p = store.getProject();
    return { layers: p.sortingLayers, layer: query.findObject(query.activeScene(p), id).sortingLayer };
  }, id);
  expect(r.layers).toContain("FG");
  expect(r.layers).not.toContain("Foreground");
  expect(r.layer).toBe("FG");
});

test("sorting-layer rename runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const ok = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addSortingLayer("Foreground");
    cmd.renameSortingLayer("Foreground", "FG");
    return store.getProject().sortingLayers.includes("FG");
  });
  expect(ok).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
