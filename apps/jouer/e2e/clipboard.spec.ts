import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity clipboard for GameObjects: Cut (Ctrl+X), Copy (Ctrl+C),
// Paste (Ctrl+V — same hierarchy level), Paste as Child (Ctrl+Shift+V). Unlike
// Duplicate, the clipboard persists across selection + scene changes, so you can
// paste a copied object into another scene. These specs drive the live editor
// through `window.__mj` (model + live Phaser node). Under the `desktop` project
// (shipped bundle + Tauri CSP) this file doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("copy then paste adds a fresh-id clone at the same position, selected, in one undo step", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 120, y: 80 });
    store.selectOne(id);
    cmd.copySelection();
    cmd.paste();
    const scene = query.activeScene(store.getProject());
    const pastedId = store.selection[0];
    const pasted = query.findObject(scene, pastedId);
    const orig = query.findObject(scene, id);
    return {
      count: scene.objects.length,
      origId: id,
      pastedId,
      pastedX: pasted.transform.x,
      pastedY: pasted.transform.y,
      origX: orig.transform.x,
      origY: orig.transform.y,
      selection: store.selection,
    };
  });
  expect(r.count).toBe(2);
  expect(r.pastedId).not.toBe(r.origId);
  expect(r.pastedX).toBe(r.origX); // Unity's Paste keeps the original position
  expect(r.pastedY).toBe(r.origY);
  expect(r.selection).toEqual([r.pastedId]);

  await waitForNode(page, r.pastedId); // the clone gets a live node

  const afterUndo = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.undo();
    return query.activeScene(store.getProject()).objects.length;
  });
  expect(afterUndo).toBe(1); // paste is a single undo step
});

test("cut removes the selection but keeps it on the clipboard for paste", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 150 });
    store.selectOne(id);
    cmd.cutSelection();
    const afterCut = query.activeScene(store.getProject()).objects.length;
    const canPaste = cmd.canPaste();
    cmd.paste();
    const afterPaste = query.activeScene(store.getProject()).objects.length;
    return { afterCut, canPaste, afterPaste };
  });
  expect(r.afterCut).toBe(0); // cut deleted it
  expect(r.canPaste).toBe(true); // …but it's on the clipboard
  expect(r.afterPaste).toBe(1); // pasted back
});

test("the clipboard survives a scene switch (cross-scene paste)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100, patch: { name: "Crosser" } });
    store.selectOne(id);
    cmd.copySelection();
    const sceneB = cmd.addScene(); // creates + switches to a new, empty scene
    cmd.paste();
    const proj = store.getProject();
    const active = query.activeScene(proj);
    return { sceneB, activeId: proj.activeSceneId, pastedInActive: active.objects.length, name: active.objects[0]?.name };
  });
  expect(r.activeId).toBe(r.sceneB);
  expect(r.pastedInActive).toBe(1); // pasted into the NEW scene
  expect(r.name).toBe("Crosser");
});

test("paste as child nests the clone inside the selected container", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const rect = cmd.addObject("rectangle", { x: 100, y: 100 });
    const cont = cmd.addObject("container", { x: 0, y: 0 });
    store.selectOne(rect);
    cmd.copySelection();
    store.selectOne(cont);
    cmd.pasteAsChild();
    const scene = query.activeScene(store.getProject());
    const container = query.findObject(scene, cont);
    const pastedId = store.selection[0];
    const parent = query.findParent(scene, pastedId);
    return { topLevel: scene.objects.length, childCount: container.children.length, parentId: parent ? parent.id : null, contId: cont };
  });
  expect(r.topLevel).toBe(2); // original rect + container; the clone is nested
  expect(r.childCount).toBe(1);
  expect(r.parentId).toBe(r.contId);
});

test("copying a container together with one of its children pastes the container only once", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 200, y: 100 });
    store.select([a, b]);
    cmd.groupSelection(); // wraps a + b in a container, selects it
    const original = query.activeScene(store.getProject()).objects.find((o: any) => o.kind === "container");
    // select the container AND one of its children, then copy + paste
    store.select([original.id, original.children[0].id]);
    cmd.copySelection();
    cmd.paste();
    const scene = query.activeScene(store.getProject());
    const pasted = scene.objects.find((o: any) => o.kind === "container" && o.id !== original.id);
    return {
      rootCount: scene.objects.length, // exactly 2 containers, no stray child
      containers: scene.objects.filter((o: any) => o.kind === "container").length,
      pastedChildren: pasted ? pasted.children.length : -1,
    };
  });
  expect(r.containers).toBe(2); // child was deduped → only the container cloned
  expect(r.pastedChildren).toBe(2); // …and the clone kept both its children
  expect(r.rootCount).toBe(2); // no orphaned child pasted at the root
});

test("paste with an empty clipboard is a no-op", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.addObject("rectangle", { x: 10, y: 10 });
    const before = query.activeScene(store.getProject()).objects.length;
    const canPaste = cmd.canPaste();
    cmd.paste();
    const after = query.activeScene(store.getProject()).objects.length;
    return { before, after, canPaste };
  });
  expect(r.canPaste).toBe(false);
  expect(r.after).toBe(r.before);
});

test("copy/paste runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const pastedId = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 150, y: 120 });
    store.selectOne(id);
    cmd.copySelection();
    cmd.paste();
    return store.selection[0];
  });
  await waitForNode(page, pastedId);
  expect(await cspViolations(page)).toEqual([]);
});
