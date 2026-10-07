import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Rigidbody2D angular acceleration (Unity ConstantForce2D torque): a
// constant rotational force applied every physics step to a DYNAMIC body, distinct
// from the initial angularVelocity. Exported as Phaser body.setAngularAcceleration.
// The editor doesn't simulate physics, so — like the other rigidbody fields — specs
// assert the model, the .jouer round-trip and the exported code. Under the `desktop`
// project the last test doubles as the feature's CSP smoke.

// A full dynamic arcade body with overrides (runs in the page).
const DBODY = (over: Record<string, unknown> = {}) => ({
  bodyType: "dynamic",
  shape: "box", mass: 1, drag: 0, angularVelocity: 0, angularAcceleration: 0, angularDrag: 0, freezeRotation: false,
  velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0,
  collideWorldBounds: false, immovable: false, allowGravity: true,
  ...over,
});

const exportJs = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("angular acceleration is preserved in the model and round-trips through .jouer", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return id;
  }, DBODY({ angularAcceleration: 90 }));
  const r = await page.evaluate((id) => {
    const { store, jouer, query } = window.__mj;
    const live = query.findObject(query.activeScene(store.getProject()), id).body;
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bo = query.findObject(back.scenes.find((s: any) => s.id === back.activeSceneId), id).body;
    return { live: live.angularAcceleration, back: bo.angularAcceleration };
  }, id);
  expect(r).toEqual({ live: 90, back: 90 });
});

test("a dynamic body with angular acceleration exports body.setAngularAcceleration", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
  }, DBODY({ angularAcceleration: 90 }));
  expect(await exportJs(page)).toContain("setAngularAcceleration(90)");
});

test("a body with no angular acceleration emits no setAngularAcceleration", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
  }, DBODY());
  expect(await exportJs(page)).not.toContain("setAngularAcceleration");
});

test("rigidbody angular acceleration runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
  }, DBODY({ angularAcceleration: -45 }));
  expect(await exportJs(page)).toContain("setAngularAcceleration(-45)");
  expect(await cspViolations(page)).toEqual([]);
});
