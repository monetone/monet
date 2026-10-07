import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, near, cspViolations } from "./helpers";

// Unity-parity "Frame Selected" (F): centre + zoom the viewport on the current
// selection so it fills the view (Shift+F still fits the whole scene). These
// specs drive the real live editor and read the live Phaser camera back through
// the `window.__mj.camera()` probe, so they assert the on-screen viewport — not
// just intent. Running under the `desktop` project (the shipped bundle + Tauri
// CSP) this file doubles as the feature's CSP smoke test.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("F frames the selected object: centres the camera on it and zooms in", async ({ page }) => {
  const before = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 800, y: 460, patch: { width: 40, height: 30 } });
    store.selectOne(id);
    return { id, cam: window.__mj.camera()! };
  });
  await waitForNode(page, before.id);

  // Drive the real keyboard shortcut (use-shortcuts.ts), not the command directly.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" })));

  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 800) < 2 && Math.abs(c.centerY - 460) < 2;
  }, null, { timeout: 8000 });

  const after = await page.evaluate(() => window.__mj.camera()!);
  near(after.centerX, 800, 2);
  near(after.centerY, 460, 2);
  expect(after.zoom).toBeGreaterThan(before.cam.zoom); // a small object → zoomed in
});

test("Shift+F still fits the whole scene (centres on scene centre, not the selection)", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 880, y: 500, patch: { width: 30, height: 30 } });
    store.selectOne(id);
  });

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", shiftKey: true })));

  // Scene is 960×540 → centre (480, 270), regardless of what's selected.
  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 480) < 2 && Math.abs(c.centerY - 270) < 2;
  }, null, { timeout: 8000 });
  const c = await page.evaluate(() => window.__mj.camera()!);
  near(c.centerX, 480, 2);
  near(c.centerY, 270, 2);
});

test("frameSelected on a multi-selection centres on the combined bounds", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 200, y: 150, patch: { width: 40, height: 40 } });
    const b = cmd.addObject("rectangle", { x: 700, y: 450, patch: { width: 40, height: 40 } });
    store.select([a, b]);
    return { a, b };
  });
  await waitForNode(page, ids.a);
  await waitForNode(page, ids.b);

  await page.evaluate(() => window.__mj.frameSelected());

  // Combined bounds x:180..720 → cx 450; y:130..470 → cy 300.
  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 450) < 3 && Math.abs(c.centerY - 300) < 3;
  }, null, { timeout: 8000 });
  const c = await page.evaluate(() => window.__mj.camera()!);
  near(c.centerX, 450, 3);
  near(c.centerY, 300, 3);
});

test("frameSelected with no selection leaves the camera unchanged", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { store } = window.__mj;
    store.clearSelection();
    const before = window.__mj.camera()!;
    window.__mj.frameSelected();
    return { before, after: window.__mj.camera()! };
  });
  expect(r.after.zoom).toBe(r.before.zoom);
  expect(r.after.centerX).toBe(r.before.centerX);
  expect(r.after.centerY).toBe(r.before.centerY);
});

test("frameSelected frames a selected object even when it is hidden and locked", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 820, y: 480, patch: { width: 50, height: 50 } });
    cmd.setVisible(id, false);
    cmd.setLocked(id, true);
    store.selectOne(id);
    return id;
  });
  await waitForNode(page, id);

  await page.evaluate(() => window.__mj.frameSelected());

  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 820) < 3 && Math.abs(c.centerY - 480) < 3;
  }, null, { timeout: 8000 });
  const c = await page.evaluate(() => window.__mj.camera()!);
  near(c.centerX, 820, 3);
  near(c.centerY, 480, 3);
});

test("Frame Selected runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 700, y: 400, patch: { width: 60, height: 40 } });
    store.selectOne(id);
    return id;
  });
  await waitForNode(page, id); // let the scene build the node before framing it

  await page.evaluate(() => window.__mj.frameSelected());
  await page.waitForFunction(() => {
    const c = window.__mj.camera();
    return !!c && Math.abs(c.centerX - 700) < 3 && Math.abs(c.centerY - 400) < 3;
  }, null, { timeout: 8000 });
  expect(await cspViolations(page)).toEqual([]);
});
