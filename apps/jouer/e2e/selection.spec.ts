import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Edit-menu selection commands: Select All (⌘A), Deselect All
// (⇧D), Invert Selection (⌘I) and Select Children. These drive the live editor
// through `window.__mj` (the model + store). Under the `desktop` project
// (shipped bundle + Tauri CSP) this file doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("selectAll selects every object, including nested children", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.addObject("rectangle", { x: 50, y: 50 });
    const c = cmd.addObject("container", { x: 0, y: 0 });
    const child = cmd.addObject("rectangle", { x: 10, y: 10 });
    cmd.reparent(child, c);
    store.clearSelection();
    cmd.selectAll();
    const scene = query.activeScene(store.getProject());
    const allIds = query.flattenObjects(scene).map((o: any) => o.id).sort();
    return { selection: [...store.selection].sort(), allIds };
  });
  expect(r.allIds).toHaveLength(3); // rect + container + nested child
  expect(r.selection).toEqual(r.allIds);
});

test("deselectAll clears the selection", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    store.selectOne(a);
    const before = store.selection.length;
    cmd.deselectAll();
    return { before, after: store.selection.length };
  });
  expect(r.before).toBe(1);
  expect(r.after).toBe(0);
});

test("invertSelection selects the complement of the current selection", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 0, y: 0 });
    const b = cmd.addObject("rectangle", { x: 100, y: 0 });
    const c = cmd.addObject("rectangle", { x: 200, y: 0 });
    store.select([a]);
    cmd.invertSelection();
    return { selection: [...store.selection].sort(), expected: [b, c].sort() };
  });
  expect(r.selection).toEqual(r.expected);
});

test("selectChildren replaces the selection with a container's descendants", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 200, y: 100 });
    store.select([a, b]);
    cmd.groupSelection(); // wraps a + b into a container, selects it
    const scene = query.activeScene(store.getProject());
    const container = scene.objects.find((o: any) => o.kind === "container");
    store.selectOne(container.id);
    cmd.selectChildren();
    return { selection: [...store.selection].sort(), childIds: container.children.map((o: any) => o.id).sort() };
  });
  expect(r.selection).toEqual(r.childIds);
});

test("Ctrl+A selects all via the real keyboard shortcut", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.addObject("rectangle", { x: 10, y: 10 });
    cmd.addObject("rectangle", { x: 20, y: 20 });
    store.clearSelection();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true }));
    const scene = query.activeScene(store.getProject());
    return { selCount: store.selection.length, total: query.flattenObjects(scene).length };
  });
  expect(r.total).toBe(2);
  expect(r.selCount).toBe(2);
});

test("Ctrl+I inverts via the real keyboard shortcut", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 0, y: 0 });
    const b = cmd.addObject("rectangle", { x: 50, y: 0 });
    store.select([a]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true }));
    return { selection: [...store.selection], bId: b };
  });
  expect(r.selection).toEqual([r.bId]);
});

test("Shift+D deselects all via the real keyboard shortcut", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    store.selectOne(a);
    const before = store.selection.length;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "D", shiftKey: true }));
    return { before, after: store.selection.length };
  });
  expect(r.before).toBe(1);
  expect(r.after).toBe(0);
});

test("selectAll on an empty scene is a harmless no-op", async ({ page }) => {
  const sel = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.selectAll(); // default scene starts empty
    return store.selection.length;
  });
  expect(sel).toBe(0);
});

test("selection commands run under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addObject("rectangle", { x: 10, y: 10 });
    cmd.addObject("rectangle", { x: 20, y: 20 });
    cmd.selectAll();
    cmd.invertSelection();
    cmd.selectChildren();
    cmd.deselectAll();
  });
  expect(await cspViolations(page)).toEqual([]);
});
