import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, waitProbe, cspViolations } from "./helpers";

// Unity-parity Transform "Reset" (and its per-property variants). Resets
// position → 0, rotation → 0, scale → 1, always preserving origin + alpha (which
// aren't part of Unity's Transform). Specs drive the live editor through
// `window.__mj` and read the live Phaser node via probe. Under the `desktop`
// project (shipped bundle + Tauri CSP) this doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

async function makeRich(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 150 });
    cmd.updateTransform(id, { scaleX: 2, scaleY: 3, angle: 45, originX: 0.3, originY: 0.7, alpha: 0.5 });
    store.selectOne(id);
    return id;
  });
}

const read = (page: import("@playwright/test").Page, id: string) =>
  page.evaluate((oid) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), oid).transform, id);

test("Reset Transform (all) zeroes position + rotation, sets scale to 1, keeps origin + alpha", async ({ page }) => {
  const id = await makeRich(page);
  await waitForNode(page, id);
  await page.evaluate(() => window.__mj.cmd.resetTransform("all"));
  const t = await read(page, id);
  expect(t).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0, originX: 0.3, originY: 0.7, alpha: 0.5 });
  await waitProbe(page, id, "x", 0); // the live node moved too
});

test("Reset position leaves rotation + scale untouched", async ({ page }) => {
  const id = await makeRich(page);
  await page.evaluate(() => window.__mj.cmd.resetTransform("position"));
  const t = await read(page, id);
  expect({ x: t.x, y: t.y }).toEqual({ x: 0, y: 0 });
  expect({ scaleX: t.scaleX, scaleY: t.scaleY, angle: t.angle }).toEqual({ scaleX: 2, scaleY: 3, angle: 45 });
});

test("Reset rotation leaves position + scale untouched", async ({ page }) => {
  const id = await makeRich(page);
  await page.evaluate(() => window.__mj.cmd.resetTransform("rotation"));
  const t = await read(page, id);
  expect(t.angle).toBe(0);
  expect({ x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY }).toEqual({ x: 200, y: 150, scaleX: 2, scaleY: 3 });
});

test("Reset scale leaves position + rotation untouched", async ({ page }) => {
  const id = await makeRich(page);
  await page.evaluate(() => window.__mj.cmd.resetTransform("scale"));
  const t = await read(page, id);
  expect({ scaleX: t.scaleX, scaleY: t.scaleY }).toEqual({ scaleX: 1, scaleY: 1 });
  expect({ x: t.x, y: t.y, angle: t.angle }).toEqual({ x: 200, y: 150, angle: 45 });
});

test("Reset Transform applies to every selected object", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 300, y: 200 });
    cmd.updateTransform(a, { angle: 30 });
    cmd.updateTransform(b, { angle: 60 });
    store.select([a, b]);
    cmd.resetTransform("all");
    const scene = query.activeScene(store.getProject());
    return { a: query.findObject(scene, a).transform, b: query.findObject(scene, b).transform };
  });
  expect({ x: r.a.x, y: r.a.y, angle: r.a.angle }).toEqual({ x: 0, y: 0, angle: 0 });
  expect({ x: r.b.x, y: r.b.y, angle: r.b.angle }).toEqual({ x: 0, y: 0, angle: 0 });
});

test("Reset Transform leaves locked objects untouched", async ({ page }) => {
  const t = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 150 });
    cmd.updateTransform(id, { angle: 45 });
    cmd.setLocked(id, true);
    store.selectOne(id);
    cmd.resetTransform("all");
    return query.findObject(query.activeScene(store.getProject()), id).transform;
  });
  expect({ x: t.x, y: t.y, angle: t.angle }).toEqual({ x: 200, y: 150, angle: 45 });
});

test("Reset Transform with no selection is a no-op", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 150 });
    store.clearSelection();
    cmd.resetTransform("all");
    return window.__mj.query.findObject(window.__mj.query.activeScene(store.getProject()), id).transform.x;
  });
  expect(r).toBe(200);
});

test("Reset Transform is a single undo step", async ({ page }) => {
  const id = await makeRich(page);
  const r = await page.evaluate((oid) => {
    const { cmd, store, query } = window.__mj;
    cmd.resetTransform("all");
    const after = query.findObject(query.activeScene(store.getProject()), oid).transform.x;
    cmd.undo();
    const restored = query.findObject(query.activeScene(store.getProject()), oid).transform.x;
    return { after, restored };
  }, id);
  expect(r.after).toBe(0);
  expect(r.restored).toBe(200); // one undo restores the pre-reset position
});

test("Reset Transform runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await makeRich(page);
  await waitForNode(page, id);
  await page.evaluate(() => window.__mj.cmd.resetTransform("all"));
  expect(await cspViolations(page)).toEqual([]);
});
