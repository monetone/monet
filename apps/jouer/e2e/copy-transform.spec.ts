import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Copy Component / Paste Component Values for the Transform: copy
// one object's position/rotation/scale and paste those values onto other
// existing objects (distinct from the object clipboard, which duplicates whole
// objects). Origin + alpha are preserved on the paste target. Specs drive the
// live editor through `window.__mj`. Under the `desktop` project (shipped bundle
// + Tauri CSP) this doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("paste applies the copied position/rotation/scale, keeping the target's origin + alpha", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 50 });
    cmd.updateTransform(a, { scaleX: 2, scaleY: 3, angle: 45 });
    const b = cmd.addObject("rectangle", { x: 400, y: 400 });
    cmd.updateTransform(b, { originX: 0.2, originY: 0.8, alpha: 0.5 });
    store.selectOne(a);
    cmd.copyTransform();
    store.selectOne(b);
    cmd.pasteTransform();
    return query.findObject(query.activeScene(store.getProject()), b).transform;
  });
  expect({ x: r.x, y: r.y, scaleX: r.scaleX, scaleY: r.scaleY, angle: r.angle })
    .toEqual({ x: 100, y: 50, scaleX: 2, scaleY: 3, angle: 45 }); // copied from A
  expect({ originX: r.originX, originY: r.originY, alpha: r.alpha })
    .toEqual({ originX: 0.2, originY: 0.8, alpha: 0.5 }); // B's own, preserved
});

test("paste applies to every selected object", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateTransform(a, { angle: 90 });
    const b = cmd.addObject("rectangle", { x: 200, y: 200 });
    const c = cmd.addObject("rectangle", { x: 300, y: 300 });
    store.selectOne(a);
    cmd.copyTransform();
    store.select([b, c]);
    cmd.pasteTransform();
    const scene = query.activeScene(store.getProject());
    return { b: query.findObject(scene, b).transform, c: query.findObject(scene, c).transform };
  });
  expect({ x: r.b.x, y: r.b.y, angle: r.b.angle }).toEqual({ x: 100, y: 100, angle: 90 });
  expect({ x: r.c.x, y: r.c.y, angle: r.c.angle }).toEqual({ x: 100, y: 100, angle: 90 });
});

test("paste leaves locked objects untouched", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 400, y: 400 });
    cmd.setLocked(b, true);
    store.selectOne(a);
    cmd.copyTransform();
    store.selectOne(b);
    cmd.pasteTransform();
    return query.findObject(query.activeScene(store.getProject()), b).transform;
  });
  expect({ x: r.x, y: r.y }).toEqual({ x: 400, y: 400 });
});

test("paste with nothing selected is a no-op", async ({ page }) => {
  const x = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(a);
    cmd.copyTransform();
    store.clearSelection();
    cmd.pasteTransform();
    return query.findObject(query.activeScene(store.getProject()), a).transform.x;
  });
  expect(x).toBe(100);
});

test("paste with an empty clipboard is a no-op", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(a);
    const canPaste = cmd.canPasteTransform();
    cmd.pasteTransform();
    return { canPaste, x: query.findObject(query.activeScene(store.getProject()), a).transform.x };
  });
  expect(r.canPaste).toBe(false);
  expect(r.x).toBe(100);
});

test("paste is a single undo step", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 400, y: 400 });
    store.selectOne(a);
    cmd.copyTransform();
    store.selectOne(b);
    cmd.pasteTransform();
    const after = query.findObject(query.activeScene(store.getProject()), b).transform.x;
    cmd.undo();
    const restored = query.findObject(query.activeScene(store.getProject()), b).transform.x;
    return { after, restored };
  });
  expect(r.after).toBe(100); // pasted A's x
  expect(r.restored).toBe(400); // one undo restores B
});

test("copy/paste transform runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 200, y: 200 });
    store.selectOne(a);
    cmd.copyTransform();
    store.selectOne(b);
    cmd.pasteTransform();
  });
  expect(await cspViolations(page)).toEqual([]);
});
