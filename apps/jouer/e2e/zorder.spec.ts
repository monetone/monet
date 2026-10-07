import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode } from "./helpers";

// Z-order, driven through the live app. Jouer has two independent stacking
// mechanisms and objects.spec's "reorder by depth" test actually only exercises
// reparent — so neither is covered end-to-end:
//   • depth  — the Phaser render order (bringToFront / sendToBack mutate `depth`)
//   • array  — the sibling-list order (reorder moves a node within its siblings)
// We assert the model (the source of truth the EditorScene reads each frame) and
// confirm the live nodes survive every mutation.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

/** Create n rectangles at the scene root and return their ids (creation order). */
async function addRects(page: import("@playwright/test").Page, n: number): Promise<string[]> {
  const ids = await page.evaluate((n) => {
    const { cmd } = window.__mj;
    return Array.from({ length: n }, (_, i) => cmd.addObject("rectangle", { x: 40 + i * 20, y: 50 }));
  }, n);
  for (const id of ids) await waitForNode(page, id);
  return ids;
}

test("addObject assigns each new node a strictly increasing depth", async ({ page }) => {
  const ids = await addRects(page, 3);
  const depths = await page.evaluate((ids) => {
    const objs = window.__mj.store.getProject().scenes[0].objects;
    return ids.map((id) => objs.find((o: any) => o.id === id).depth);
  }, ids);
  expect(depths[0]).toBeLessThan(depths[1]);
  expect(depths[1]).toBeLessThan(depths[2]);
});

test("bringToFront / sendToBack drive a node to the depth extremes; live nodes survive", async ({ page }) => {
  const [a, b, c] = await addRects(page, 3);

  const front = await page.evaluate((a) => {
    window.__mj.cmd.bringToFront(a);
    const objs = window.__mj.store.getProject().scenes[0].objects;
    return Object.fromEntries(objs.map((o: any) => [o.id, o.depth]));
  }, a);
  expect(front[a]).toBeGreaterThan(front[b]);
  expect(front[a]).toBeGreaterThan(front[c]);

  const back = await page.evaluate((a) => {
    window.__mj.cmd.sendToBack(a);
    const objs = window.__mj.store.getProject().scenes[0].objects;
    return Object.fromEntries(objs.map((o: any) => [o.id, o.depth]));
  }, a);
  expect(back[a]).toBeLessThan(back[b]);
  expect(back[a]).toBeLessThan(back[c]);

  // the running EditorScene reconciled every mutation without dropping a node
  for (const id of [a, b, c]) {
    expect(await page.evaluate((id) => window.__mj.probe(id) !== null, id), `node ${id} alive`).toBe(true);
  }
});

test("reorder moves a node within its sibling array order", async ({ page }) => {
  const ids = await addRects(page, 3);
  const [a, b, c] = ids;
  // relative order of OUR three nodes (robust to any default scene content)
  const order = async () =>
    page.evaluate((ids) => window.__mj.store.getProject().scenes[0].objects.map((o: any) => o.id).filter((id: string) => ids.includes(id)), ids);

  expect(await order()).toEqual([a, b, c]);
  await page.evaluate((c) => window.__mj.cmd.reorder(c, -1), c); // c up one
  expect(await order()).toEqual([a, c, b]);
  await page.evaluate((c) => window.__mj.cmd.reorder(c, -1), c); // c up again → front of the trio
  expect(await order()).toEqual([c, a, b]);
  await page.evaluate((c) => window.__mj.cmd.reorder(c, 1), c); // c back down one
  expect(await order()).toEqual([a, c, b]);
});

test("undo reverts a bringToFront depth change", async ({ page }) => {
  const [a] = await addRects(page, 2);
  const res = await page.evaluate((a) => {
    const { cmd, store } = window.__mj;
    const depthOf = () => store.getProject().scenes[0].objects.find((o: any) => o.id === a).depth;
    const before = depthOf();
    cmd.bringToFront(a);
    const bumped = depthOf();
    cmd.undo();
    return { before, bumped, restored: depthOf() };
  }, a);
  expect(res.bumped).toBeGreaterThan(res.before);
  expect(res.restored).toBe(res.before);
});
