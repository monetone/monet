import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Rigidbody2D Body Type "Kinematic": a body that ignores gravity
// and isn't pushed by collisions but moves by its own velocity. Exported as a
// Phaser dynamic body with setImmovable(true) + setAllowGravity(false) (the
// standard arcade kinematic setup). The editor doesn't simulate physics, so —
// like the other rigidbody fields — specs assert the model + the exported code.
// Under the `desktop` project this doubles as the feature's CSP smoke.

// A full kinematic arcade body with overrides (runs in the page).
const KBODY = (over: Record<string, unknown> = {}) => ({
  bodyType: "kinematic",
  shape: "box", mass: 1, drag: 0, angularVelocity: 0, angularDrag: 0, freezeRotation: false,
  velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0,
  collideWorldBounds: false, immovable: false, allowGravity: true,
  ...over,
});

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("setting bodyType kinematic updates the model", async ({ page }) => {
  const t = await page.evaluate((body) => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    return query.findObject(query.activeScene(store.getProject()), id).body.bodyType;
  }, KBODY({ velocityX: 40 }));
  expect(t).toBe("kinematic");
});

test("a kinematic body exports as immovable + no-gravity (not static, no setGravityY)", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, KBODY({ velocityX: 40, gravityY: 500 }));
  expect(js).toContain("setImmovable(true)");
  expect(js).toContain("setAllowGravity(false)");
  expect(js).toContain("setVelocity(40, 0)");
  expect(js).not.toContain("setGravityY"); // kinematic ignores gravity even if gravityY is set
  expect(js).not.toMatch(/add\.existing\([A-Za-z0-9_$]+, true\)/); // dynamic body, not static
});

test("a kinematic body survives a .jouer round-trip", async ({ page }) => {
  const t = await page.evaluate((body) => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return query.findObject(scene, id).body.bodyType;
  }, KBODY());
  expect(t).toBe("kinematic");
});

test("the dynamic export path is unchanged (gravity still emitted for dynamic)", async ({ page }) => {
  const js = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body: { bodyType: "dynamic", shape: "box", velocityX: 0, velocityY: 0, gravityY: 300, bounceX: 0, bounceY: 0, collideWorldBounds: false, immovable: false, allowGravity: true } });
    return window.__mj.exporter.exportGameJs(store.getProject());
  });
  expect(js).toContain("setGravityY(300)"); // dynamic still gets gravity
  expect(js).not.toContain("setImmovable(true)"); // and isn't forced immovable
});

test("kinematic body runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    window.__mj.exporter.exportGameJs(store.getProject());
  }, KBODY({ velocityX: 30 }));
  expect(await cspViolations(page)).toEqual([]);
});
