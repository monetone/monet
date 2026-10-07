import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, waitProbe, cspViolations } from "./helpers";

// Unity-parity transform flip — the Edit-menu "Flip Horizontal/Vertical",
// realised as a negative-scale mirror (Unity's transform-level flip). Single
// objects flip in place; multi-selections mirror across the selection centre.
// (The per-object render-only SpriteRenderer Flip X/Y lives in flip-sprite.spec.ts.)
// Specs drive the live editor through `window.__mj` and read the live Phaser
// node via probe. Under the `desktop` project (shipped bundle + Tauri CSP) this
// file doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("Flip Horizontal mirrors a single object in place (model + live node)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    cmd.flipSelection("horizontal");
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { id, x: o.transform.x, scaleX: o.transform.scaleX };
  });
  expect(r.x).toBe(100); // single object flips in place
  expect(r.scaleX).toBe(-1);
  await waitProbe(page, r.id, "scaleX", -1); // the live Phaser node mirrors
});

test("Flip Horizontal mirrors a group across its centre", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 0 });
    const b = cmd.addObject("rectangle", { x: 300, y: 0 });
    store.select([a, b]);
    cmd.flipSelection("horizontal");
    const scene = query.activeScene(store.getProject());
    const oa = query.findObject(scene, a).transform;
    const ob = query.findObject(scene, b).transform;
    return { ax: oa.x, asx: oa.scaleX, bx: ob.x, bsx: ob.scaleX };
  });
  // centre 200 → 100↔300; each object also flips
  expect(r.ax).toBe(300);
  expect(r.bx).toBe(100);
  expect(r.asx).toBe(-1);
  expect(r.bsx).toBe(-1);
});

test("Flip Vertical negates scaleY and leaves the horizontal axis untouched", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 80 });
    store.selectOne(id);
    cmd.flipSelection("vertical");
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { y: o.transform.y, scaleY: o.transform.scaleY, scaleX: o.transform.scaleX };
  });
  expect(r.y).toBe(80);
  expect(r.scaleY).toBe(-1);
  expect(r.scaleX).toBe(1);
});

test("flipping a group twice restores the original layout", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 0 });
    const b = cmd.addObject("rectangle", { x: 300, y: 0 });
    store.select([a, b]);
    cmd.flipSelection("horizontal");
    cmd.flipSelection("horizontal");
    const scene = query.activeScene(store.getProject());
    return {
      ax: query.findObject(scene, a).transform.x,
      asx: query.findObject(scene, a).transform.scaleX,
      bx: query.findObject(scene, b).transform.x,
    };
  });
  expect(r.ax).toBe(100);
  expect(r.bx).toBe(300);
  expect(r.asx).toBe(1);
});

test("flip is one undo step", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    cmd.flipSelection("horizontal");
    const flipped = query.findObject(query.activeScene(store.getProject()), id).transform.scaleX;
    cmd.undo();
    const restored = query.findObject(query.activeScene(store.getProject()), id).transform.scaleX;
    return { flipped, restored };
  });
  expect(r.flipped).toBe(-1);
  expect(r.restored).toBe(1);
});

test("flip leaves locked objects untouched", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.setLocked(id, true);
    store.selectOne(id);
    cmd.flipSelection("horizontal");
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { x: o.transform.x, scaleX: o.transform.scaleX };
  });
  expect(r).toEqual({ x: 100, scaleX: 1 });
});

test("flip with no selection is a no-op", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("rectangle", { x: 10, y: 10 });
    store.clearSelection();
    const before = store.getProject().scenes[0].objects[0].transform.scaleX;
    cmd.flipSelection("horizontal");
    const after = store.getProject().scenes[0].objects[0].transform.scaleX;
    return { before, after };
  });
  expect(r.after).toBe(r.before);
});

test("flip runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    cmd.flipSelection("horizontal");
    cmd.flipSelection("vertical");
    return id;
  });
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
