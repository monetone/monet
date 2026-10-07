import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity "Isolate Selection" (Scene Visibility / Shift+H): a temporary,
// editor-only view that shows only the selected objects (and their children),
// hides everything else, and reveals even model-hidden objects — without
// touching the model or export. Specs drive the live editor through
// `window.__mj` and read the live Phaser node's `visible`. Under the `desktop`
// project (shipped bundle + Tauri CSP) this doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("isolate hides everything but the selection; exiting restores visibility", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 200, y: 100 });
    store.selectOne(a);
    cmd.toggleIsolateSelection();
    return { a, b };
  });
  await waitForNode(page, ids.a);
  await waitForNode(page, ids.b);
  await page.waitForFunction((i) => {
    const a = window.__mj.probe(i.a), b = window.__mj.probe(i.b);
    return !!a && !!b && a.visible === true && b.visible === false;
  }, ids, { timeout: 8000 });

  // exit isolation → both visible again
  await page.evaluate(() => window.__mj.cmd.toggleIsolateSelection());
  await page.waitForFunction((i) => {
    const a = window.__mj.probe(i.a), b = window.__mj.probe(i.b);
    return !!a && !!b && a.visible === true && b.visible === true;
  }, ids, { timeout: 8000 });
});

test("isolating a container keeps its children visible but hides outsiders", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 200, y: 100 });
    store.select([a, b]);
    cmd.groupSelection(); // wraps a + b into a container
    const outsider = cmd.addObject("rectangle", { x: 400, y: 100 });
    const container = query.activeScene(store.getProject()).objects.find((o: any) => o.kind === "container");
    store.selectOne(container.id);
    cmd.toggleIsolateSelection();
    return { child: container.children[0].id, outsider };
  });
  await waitForNode(page, ids.child);
  await waitForNode(page, ids.outsider);
  await page.waitForFunction((i) => {
    const child = window.__mj.probe(i.child), out = window.__mj.probe(i.outsider);
    return !!child && !!out && child.visible === true && out.visible === false;
  }, ids, { timeout: 8000 });
});

test("isolating a model-hidden object reveals it in the editor", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.setVisible(id, false); // hidden in the model
    store.selectOne(id);
    cmd.toggleIsolateSelection();
    return id;
  });
  await waitForNode(page, id);
  await page.waitForFunction((oid) => {
    const p = window.__mj.probe(oid);
    return !!p && p.visible === true; // isolation reveals it
  }, id, { timeout: 8000 });
});

test("Shift+H toggles isolation via the real keyboard shortcut", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 200, y: 100 });
    store.selectOne(a);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "H", shiftKey: true }));
    return { a, b, isolated: store.state.isolatedIds !== null };
  });
  expect(ids.isolated).toBe(true);
  await waitForNode(page, ids.b);
  await page.waitForFunction((i) => {
    const b = window.__mj.probe(i.b);
    return !!b && b.visible === false;
  }, ids, { timeout: 8000 });
});

test("plain H still selects the Hand tool (only Shift+H isolates)", async ({ page }) => {
  const tool = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h" }));
    return window.__mj.store.state.tool;
  });
  expect(tool).toBe("hand");
});

test("isolating with nothing selected is a no-op", async ({ page }) => {
  const isolated = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    store.clearSelection();
    cmd.toggleIsolateSelection();
    return store.state.isolatedIds;
  });
  expect(isolated).toBeNull();
});

test("isolation never changes the model's visibility (export stays intact)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 200, y: 100 });
    store.selectOne(a);
    cmd.toggleIsolateSelection();
    const scene = query.activeScene(store.getProject());
    return { aVis: query.findObject(scene, a).visible, bVis: query.findObject(scene, b).visible };
  });
  expect(r.aVis).toBe(true);
  expect(r.bVis).toBe(true); // b is editor-hidden, but its model.visible is untouched
});

test("isolate runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.addObject("rectangle", { x: 200, y: 100 });
    store.selectOne(id);
    cmd.toggleIsolateSelection();
    return id;
  });
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
