import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Rigidbody2D continuous acceleration (Unity ConstantForce2D): a
// constant force applied every physics step to a DYNAMIC body, distinct from the
// initial velocity. Exported as Phaser body.setAcceleration. The editor doesn't
// simulate physics, so — like the other rigidbody fields — specs assert the model,
// the .jouer round-trip and the exported code. Under the `desktop` project the
// last test doubles as the feature's CSP smoke.

// A full dynamic arcade body with overrides (runs in the page).
const DBODY = (over: Record<string, unknown> = {}) => ({
  bodyType: "dynamic",
  shape: "box", mass: 1, drag: 0, angularVelocity: 0, angularDrag: 0, freezeRotation: false,
  velocityX: 0, velocityY: 0, accelerationX: 0, accelerationY: 0, gravityY: 0, bounceX: 0, bounceY: 0,
  collideWorldBounds: false, immovable: false, allowGravity: true,
  ...over,
});

const exportJs = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("acceleration is preserved in the model and round-trips through .jouer", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return id;
  }, DBODY({ accelerationX: 30, accelerationY: -45 }));
  const r = await page.evaluate((id) => {
    const { store, jouer, query } = window.__mj;
    const live = query.findObject(query.activeScene(store.getProject()), id).body;
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bo = query.findObject(back.scenes.find((s: any) => s.id === back.activeSceneId), id).body;
    return { live: { x: live.accelerationX, y: live.accelerationY }, back: { x: bo.accelerationX, y: bo.accelerationY } };
  }, id);
  expect(r).toEqual({ live: { x: 30, y: -45 }, back: { x: 30, y: -45 } });
});

test("a dynamic body with acceleration exports body.setAcceleration", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
  }, DBODY({ accelerationX: 30, accelerationY: -45 }));
  expect(await exportJs(page)).toContain("setAcceleration(30, -45)");
});

test("a body with no acceleration emits no setAcceleration", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
  }, DBODY());
  expect(await exportJs(page)).not.toContain("setAcceleration");
});

test("rigidbody acceleration runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
  }, DBODY({ accelerationX: 10, accelerationY: 20 }));
  expect(await exportJs(page)).toContain("setAcceleration(10, 20)");
  expect(await cspViolations(page)).toEqual([]);
});
