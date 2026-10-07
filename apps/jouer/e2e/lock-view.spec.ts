import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, tick, near, cspViolations } from "./helpers";

// Unity-parity "Lock View to Selected" (Shift+F): the scene camera follows the
// selected object as it moves. Specs drive the live editor through `window.__mj`
// and read the live camera via the camera probe. Under the `desktop` project
// (shipped bundle + Tauri CSP) this doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the camera follows the selected object as it moves", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 200 });
    store.selectOne(id);
    cmd.toggleFollowSelection();
    return id;
  });
  await waitForNode(page, id);

  // camera locks onto the object's current position…
  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 200) < 2 && Math.abs(c.centerY - 200) < 2;
  }, null, { timeout: 8000 });

  // …and tracks it when it moves
  await page.evaluate(() => window.__mj.cmd.translateSelection(300, 100));
  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 500) < 2 && Math.abs(c.centerY - 300) < 2;
  }, null, { timeout: 8000 });
});

test("toggling the lock off stops the camera from following", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 200 });
    store.selectOne(id);
    cmd.toggleFollowSelection(); // on
    return id;
  });
  await waitForNode(page, id);
  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 200) < 2;
  }, null, { timeout: 8000 });

  const beforeX = await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.toggleFollowSelection(); // off
    const before = window.__mj.camera()!.centerX;
    cmd.translateSelection(300, 0); // object → x 500
    return before;
  });
  await tick(page, 5);
  const after = await page.evaluate(() => window.__mj.camera()!);
  near(after.centerX, beforeX, 2); // camera did NOT track the move
});

test("locking with nothing selected leaves the camera where it is", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    store.clearSelection();
    const before = window.__mj.camera()!.centerX;
    cmd.toggleFollowSelection(); // on, but nothing to follow
    return { before, following: store.state.followSelection };
  });
  expect(r.following).toBe(true);
  await tick(page, 5);
  const after = await page.evaluate(() => window.__mj.camera()!);
  near(after.centerX, r.before, 2);
});

test("toggleFollowSelection flips the followSelection state", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = store.state.followSelection;
    cmd.toggleFollowSelection();
    const b = store.state.followSelection;
    cmd.toggleFollowSelection();
    const c = store.state.followSelection;
    return { a, b, c };
  });
  expect(r).toEqual({ a: false, b: true, c: false });
});

test("lock view runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 200, y: 200 });
    store.selectOne(id);
    cmd.toggleFollowSelection();
    return id;
  });
  await waitForNode(page, id);
  await tick(page, 3);
  expect(await cspViolations(page)).toEqual([]);
});
