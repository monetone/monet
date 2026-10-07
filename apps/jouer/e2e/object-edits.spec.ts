import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, waitProbe } from "./helpers";

// Object-editing verbs the existing specs don't reach. objects.spec covers
// add/duplicate/group/align, but the edit+delete half of the toolbar —
// deleteSelection, translateSelection (with grid snap + the locked guard) and
// renameObject — had no e2e. Each drives the live app and reads back the model
// and the live Phaser node.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("deleteSelection removes the selected objects and their live nodes, clearing the selection", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 50, y: 50 });
    const b = cmd.addObject("rectangle", { x: 100, y: 50 });
    const c = cmd.addObject("rectangle", { x: 150, y: 50 });
    store.select([a, b]);
    return { a, b, c };
  });
  for (const id of [ids.a, ids.b, ids.c]) await waitForNode(page, id);

  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.deleteSelection();
    const scene = query.activeScene(store.getProject());
    return { remaining: scene.objects.map((o: any) => o.id), selection: store.selection };
  });
  expect(r.remaining).not.toContain(ids.a);
  expect(r.remaining).not.toContain(ids.b);
  expect(r.remaining).toContain(ids.c); // survivor stays
  expect(r.selection).toEqual([]); // selection cleared

  // the EditorScene reconciles the deletions out of the live scene…
  await page.waitForFunction((id) => window.__mj.probe(id) === null, ids.a, { timeout: 8000 });
  await page.waitForFunction((id) => window.__mj.probe(id) === null, ids.b, { timeout: 8000 });
  expect(await page.evaluate((id) => window.__mj.probe(id) !== null, ids.c)).toBe(true);
});

test("translateSelection moves the selected node and snaps to a grid", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    return id;
  });
  await waitForNode(page, id);

  await page.evaluate(() => window.__mj.cmd.translateSelection(50, -30));
  await waitProbe(page, id, "x", 150);
  await waitProbe(page, id, "y", 70);
  const t1 = await page.evaluate((id) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).transform, id);
  expect(t1.x).toBe(150);
  expect(t1.y).toBe(70);

  // grid snap: snap(150 + 7) on a 10-grid → 160
  await page.evaluate(() => window.__mj.cmd.translateSelection(7, 0, 10));
  const t2 = await page.evaluate((id) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).transform, id);
  expect(t2.x).toBe(160);
  expect(t2.y).toBe(70);
});

test("translateSelection leaves locked objects in place", async ({ page }) => {
  const pos = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 200 });
    cmd.setLocked(id, true);
    store.selectOne(id);
    cmd.translateSelection(50, 50);
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { x: o.transform.x, y: o.transform.y };
  });
  expect(pos).toEqual({ x: 200, y: 200 }); // locked → untouched
});

test("renameObject updates the object's name", async ({ page }) => {
  const name = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.renameObject(id, "Hero");
    return query.findObject(query.activeScene(store.getProject()), id).name;
  });
  expect(name).toBe("Hero");
});
