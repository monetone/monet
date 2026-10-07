import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, waitProbe, cspViolations } from "./helpers";

// Unity-parity "Snap to Grid" (Grid and Snap → Snap All Axes): a one-shot that
// pushes the selected objects onto the grid (distinct from Jouer's existing
// snap-while-dragging). Specs drive the live editor through `window.__mj` and
// read back the model + live Phaser node. Under the `desktop` project (shipped
// bundle + Tauri CSP) this file doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("snaps a single object's position to the nearest grid lines (model + live node)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    store.setGridSize(10);
    const id = cmd.addObject("rectangle", { x: 107, y: 53 });
    store.selectOne(id);
    cmd.snapSelectionToGrid();
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { id, x: o.transform.x, y: o.transform.y };
  });
  expect({ x: r.x, y: r.y }).toEqual({ x: 110, y: 50 });
  await waitProbe(page, r.id, "x", 110); // the live node moved too
});

test("snaps every selected object", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    store.setGridSize(10);
    const a = cmd.addObject("rectangle", { x: 22, y: 18 });
    const b = cmd.addObject("rectangle", { x: 97, y: 64 });
    store.select([a, b]);
    cmd.snapSelectionToGrid();
    const scene = query.activeScene(store.getProject());
    const oa = query.findObject(scene, a).transform;
    const ob = query.findObject(scene, b).transform;
    return { ax: oa.x, ay: oa.y, bx: ob.x, by: ob.y };
  });
  expect(r).toEqual({ ax: 20, ay: 20, bx: 100, by: 60 });
});

test("leaves locked objects in place", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    store.setGridSize(10);
    const id = cmd.addObject("rectangle", { x: 107, y: 53 });
    cmd.setLocked(id, true);
    store.selectOne(id);
    cmd.snapSelectionToGrid();
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { x: o.transform.x, y: o.transform.y };
  });
  expect(r).toEqual({ x: 107, y: 53 });
});

test("is a no-op when the grid is off (size < 2)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    store.setGridSize(1);
    const id = cmd.addObject("rectangle", { x: 107, y: 53 });
    store.selectOne(id);
    cmd.snapSelectionToGrid();
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { x: o.transform.x, y: o.transform.y };
  });
  expect(r).toEqual({ x: 107, y: 53 });
});

test("is a no-op with no selection", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    store.setGridSize(10);
    cmd.addObject("rectangle", { x: 107, y: 53 });
    store.clearSelection();
    const before = store.getProject().scenes[0].objects[0].transform.x;
    cmd.snapSelectionToGrid();
    const after = store.getProject().scenes[0].objects[0].transform.x;
    return { before, after };
  });
  expect(r.after).toBe(r.before);
});

test("adds no undo step when the selection is already aligned", async ({ page }) => {
  const count = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    store.setGridSize(10);
    const id = cmd.addObject("rectangle", { x: 100, y: 50 }); // already on the grid
    store.selectOne(id);
    cmd.snapSelectionToGrid(); // no-op → no undo step
    cmd.undo(); // undoes the ADD, not a phantom snap
    return query.activeScene(store.getProject()).objects.length;
  });
  expect(count).toBe(0); // a single undo removed the object → snap added nothing
});

test("Snap to Grid runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    store.setGridSize(10);
    const id = cmd.addObject("rectangle", { x: 107, y: 53 });
    store.selectOne(id);
    cmd.snapSelectionToGrid();
    return id;
  });
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
