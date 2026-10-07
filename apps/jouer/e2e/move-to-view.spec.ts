import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, near, cspViolations } from "./helpers";

// Unity-parity "Move to View" (Ctrl/Cmd+Alt+F): move the selection to the
// centre of the current viewport — the inverse of "Frame Selected". The model
// half (moveSelectionToPoint) is asserted directly through `window.__mj`; the
// camera-driven half (moveToView) is asserted against the live camera probe.
// Under the `desktop` project (shipped bundle + Tauri CSP) this doubles as the
// feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("moveSelectionToPoint moves a single object exactly onto the point", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    cmd.moveSelectionToPoint(500, 300);
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { x: o.transform.x, y: o.transform.y };
  });
  expect(r).toEqual({ x: 500, y: 300 });
});

test("moveSelectionToPoint centres a group and preserves its relative layout", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100 });
    const b = cmd.addObject("rectangle", { x: 300, y: 200 });
    store.select([a, b]);
    cmd.moveSelectionToPoint(0, 0);
    const scene = query.activeScene(store.getProject());
    const oa = query.findObject(scene, a).transform;
    const ob = query.findObject(scene, b).transform;
    return { ax: oa.x, ay: oa.y, bx: ob.x, by: ob.y };
  });
  // box centre was (200,150) → delta (-200,-150)
  expect({ x: r.ax, y: r.ay }).toEqual({ x: -100, y: -50 });
  expect({ x: r.bx, y: r.by }).toEqual({ x: 100, y: 50 });
  expect(r.bx - r.ax).toBe(200); // relative spacing preserved
  expect(r.by - r.ay).toBe(100);
});

test("moveSelectionToPoint leaves locked objects in place", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.setLocked(id, true);
    store.selectOne(id);
    cmd.moveSelectionToPoint(500, 300);
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { x: o.transform.x, y: o.transform.y };
  });
  expect(r).toEqual({ x: 100, y: 100 });
});

test("moveSelectionToPoint with no selection is a no-op", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("rectangle", { x: 10, y: 10 });
    store.clearSelection();
    const before = store.getProject().scenes[0].objects[0].transform.x;
    cmd.moveSelectionToPoint(999, 999);
    const after = store.getProject().scenes[0].objects[0].transform.x;
    return { before, after };
  });
  expect(r.after).toBe(r.before);
});

test("moveToView moves the selection onto the live viewport centre", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 700, y: 400, patch: { width: 40, height: 40 } });
    const b = cmd.addObject("rectangle", { x: 100, y: 100, patch: { width: 40, height: 40 } });
    store.selectOne(a);
    return { a, b };
  });
  await waitForNode(page, ids.a);
  await waitForNode(page, ids.b);

  // Frame A so the camera centres on it (700, 400)…
  await page.evaluate(() => window.__mj.frameSelected());
  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 700) < 2 && Math.abs(c.centerY - 400) < 2;
  }, null, { timeout: 8000 });

  // …then move B to the view — it should land on the camera centre.
  const pos = await page.evaluate((bId) => {
    const { store, query } = window.__mj;
    store.selectOne(bId);
    window.__mj.moveToView();
    const o = query.findObject(query.activeScene(store.getProject()), bId);
    return { x: o.transform.x, y: o.transform.y };
  }, ids.b);
  near(pos.x, 700, 2);
  near(pos.y, 400, 2);
});

test("Cmd+Alt+F moves the selection to the view centre via the real shortcut", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    return id;
  });
  await waitForNode(page, id);

  const r = await page.evaluate((oid) => {
    const { store, query } = window.__mj;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, altKey: true }));
    const o = query.findObject(query.activeScene(store.getProject()), oid);
    const cam = window.__mj.camera()!;
    return { x: o.transform.x, y: o.transform.y, cx: cam.centerX, cy: cam.centerY };
  }, id);
  near(r.x, r.cx, 2); // moved onto the (default scene-centre) viewport centre
  near(r.y, r.cy, 2);
});

test("Move to View runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    return id;
  });
  await waitForNode(page, id);
  await page.evaluate(() => window.__mj.moveToView());
  expect(await cspViolations(page)).toEqual([]);
});
