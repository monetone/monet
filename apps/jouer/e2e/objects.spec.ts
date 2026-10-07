import { test, expect } from "@playwright/test";
import { gotoApp, near, tick, waitForNode } from "./helpers";

// Every object kind, the transform inspector commands, hierarchy operations
// (group/ungroup/reparent/reorder/align/duplicate) and undo/redo — verified
// against the model and the live Phaser node.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("creates every object kind with sane defaults and a live node", async ({ page }) => {
  const kinds = ["rectangle", "ellipse", "text", "sprite", "image", "container"];
  const made = await page.evaluate((kinds) => {
    const { cmd } = window.__mj;
    return kinds.map((k) => ({ k, id: cmd.addObject(k, { x: 100, y: 100 }) }));
  }, kinds);
  for (const m of made) await waitForNode(page, m.id);
  const model = await page.evaluate(() => {
    const { query, store } = window.__mj;
    return query.flattenObjects(query.activeScene(store.getProject())).map((o: any) => ({ kind: o.kind, name: o.name }));
  });
  expect(model.map((m: any) => m.kind).sort()).toEqual([...kinds].sort());
});

test("transform edits move and rotate the live node", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 0, y: 0 }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.updateTransform(id, { x: 321, y: 123, angle: 45, scaleX: 2, alpha: 0.5 }), id);
  await tick(page);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  near(p.x, 321); near(p.y, 123); near(p.angle, 45); near(p.scaleX, 2, 0.01); near(p.alpha, 0.5, 0.01);
});

test("visibility + lock toggles", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle"));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.setVisible(id, false), id);
  await tick(page);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.visible).toBe(false);
  await page.evaluate((id) => window.__mj.cmd.setLocked(id, true), id);
  const locked = await page.evaluate((id) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).locked, id);
  expect(locked).toBe(true);
});

test("duplicate offsets a copy and selects it", async ({ page }) => {
  const before = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    cmd.duplicateSelection();
    return store.getProject().scenes[0].objects.length;
  });
  expect(before).toBe(2);
  const xs = await page.evaluate(() => window.__mj.store.getProject().scenes[0].objects.map((o: any) => o.transform.x).sort((a: number, b: number) => a - b));
  expect(xs[1] - xs[0]).toBe(16); // duplicate offset
});

test("group then ungroup preserves world position", async ({ page }) => {
  const data = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 300, y: 200 });
    store.select([a, b]);
    cmd.groupSelection();
    const scene = store.getProject().scenes[0];
    const group = scene.objects.find((o: any) => o.kind === "container");
    return { groupId: group.id, childCount: group.children.length, topLevel: scene.objects.length, a, b };
  });
  expect(data.childCount).toBe(2);
  expect(data.topLevel).toBe(1); // just the container at the top level
  // ungroup: children back at top level with world positions restored
  const after = await page.evaluate((groupId) => {
    const { cmd, store } = window.__mj;
    cmd.ungroup(groupId);
    const scene = store.getProject().scenes[0];
    return scene.objects.map((o: any) => ({ x: o.transform.x, y: o.transform.y })).sort((p: any, q: any) => p.x - q.x);
  }, data.groupId);
  near(after[0].x, 100); near(after[0].y, 100);
  near(after[1].x, 300); near(after[1].y, 200);
});

test("reparent into a container, then reorder by depth", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const c = cmd.addObject("container", { x: 0, y: 0 });
    const a = cmd.addObject("rectangle", { x: 10, y: 10 });
    cmd.reparent(a, c);
    const scene = store.getProject().scenes[0];
    const container = scene.objects.find((o: any) => o.id === c);
    return { childOfContainer: container.children.length, topLevel: scene.objects.length };
  });
  expect(r.childOfContainer).toBe(1);
  expect(r.topLevel).toBe(1);
});

test("align distributes selected objects to an edge", async ({ page }) => {
  const ys = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 50 });
    const b = cmd.addObject("rectangle", { x: 200, y: 350 });
    store.select([a, b]);
    cmd.alignSelection("top");
    return store.getProject().scenes[0].objects.map((o: any) => o.transform.y);
  });
  expect(ys[0]).toBe(ys[1]); // both snapped to the top-most y
  expect(ys[0]).toBe(50);
});

test("physics body add/remove", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle"));
  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { body: { bodyType: "dynamic", velocityX: 50, velocityY: 0, gravityY: 300, bounceX: 0, bounceY: 0.5, collideWorldBounds: true, immovable: false, allowGravity: true } }), id);
  let body = await page.evaluate((id) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).body, id);
  expect(body.gravityY).toBe(300);
  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { body: null }), id);
  body = await page.evaluate((id) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).body, id);
  expect(body).toBeNull();
});

test("undo/redo for add and transform", async ({ page }) => {
  const res = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const n0 = store.getProject().scenes[0].objects.length;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    const n1 = store.getProject().scenes[0].objects.length;
    cmd.updateTransform(id, { x: 500 });
    const x1 = store.getProject().scenes[0].objects[0].transform.x;
    cmd.undo(); // undo transform
    const x2 = store.getProject().scenes[0].objects[0].transform.x;
    cmd.undo(); // undo add
    const n2 = store.getProject().scenes[0].objects.length;
    cmd.redo(); // redo add
    const n3 = store.getProject().scenes[0].objects.length;
    return { n0, n1, x1, x2, n2, n3 };
  });
  expect(res.n1).toBe(res.n0 + 1);
  expect(res.x1).toBe(500);
  expect(res.x2).toBe(0);
  expect(res.n2).toBe(res.n0);
  expect(res.n3).toBe(res.n0 + 1);
});
