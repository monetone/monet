import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity Rigidbody2D Mass + Linear Drag on the arcade body: mass sets how
// much force is needed to move it; drag is the friction that slows its motion.
// A dynamic body exports body.setMass(m) / body.setDrag(d, d) when away from the
// defaults (mass 1, drag 0). Specs drive the live editor through `window.__mj`
// and assert the model + the exported code. Under the `desktop` project (shipped
// bundle + Tauri CSP) this doubles as the feature's CSP smoke.

// Build a full dynamic arcade body with the given overrides (runs in the page).
const BODY = (over: Record<string, number>) => ({
  bodyType: "dynamic",
  velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0,
  collideWorldBounds: false, immovable: false, allowGravity: true,
  ...over,
});

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("setting mass + drag updates the model", async ({ page }) => {
  const r = await page.evaluate((body) => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    const b = query.findObject(query.activeScene(store.getProject()), id).body;
    return { mass: b.mass, drag: b.drag };
  }, BODY({ mass: 5, drag: 2 }));
  expect(r).toEqual({ mass: 5, drag: 2 });
});

test("a dynamic body exports setMass + setDrag when away from the defaults", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, BODY({ mass: 5, drag: 2 }));
  expect(js).toContain(".body.setMass(5)");
  expect(js).toContain(".body.setDrag(2, 2)");
});

test("a body at the defaults exports neither setMass nor setDrag", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, BODY({ mass: 1, drag: 0, gravityY: 100 }));
  expect(js).toContain("this.physics.add.existing"); // the body is still created
  expect(js).not.toContain("setMass");
  expect(js).not.toContain("setDrag");
});

test("a non-positive mass or drag is not exported (would break Phaser)", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, BODY({ mass: -5, drag: -2 }));
  expect(js).toContain("this.physics.add.existing"); // the body is still created
  expect(js).not.toContain("setMass"); // mass <= 0 → suppressed (Phaser setMass(0) throws)
  expect(js).not.toContain("setDrag"); // drag < 0 → suppressed
});

test("mass + drag survive a .jouer round-trip", async ({ page }) => {
  const r = await page.evaluate((body) => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const b = scene.objects.find((o: any) => o.id === id).body;
    return { mass: b.mass, drag: b.drag };
  }, BODY({ mass: 3, drag: 1.5 }));
  expect(r).toEqual({ mass: 3, drag: 1.5 });
});

test("rigidbody mass/drag run under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return id;
  }, BODY({ mass: 2, drag: 1 }));
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});

// Unity-parity Rigidbody2D rotational dynamics: angularVelocity (deg/s, spins
// the body), angularDrag (slows the spin), and the "Freeze Rotation Z"
// constraint. A dynamic body exports body.setAngularVelocity / setAngularDrag /
// setAllowRotation(false) when away from the defaults (0 / 0 / false).

test("a dynamic body exports angular velocity, drag + freeze rotation when set", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, BODY({ angularVelocity: 180, angularDrag: 0.5, freezeRotation: true }));
  expect(js).toContain(".body.setAngularVelocity(180)");
  expect(js).toContain(".body.setAngularDrag(0.5)");
  expect(js).toContain(".body.setAllowRotation(false)");
});

test("freeze rotation alone exports setAllowRotation(false) without any angular motion", async ({ page }) => {
  // The canonical "Freeze Rotation Z" use is an object you want to NOT spin —
  // freezeRotation with zero angular velocity. Its guard is independent, so
  // assert it emits on its own (a guard coupled to angularVelocity would fail).
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, BODY({ angularVelocity: 0, angularDrag: 0, freezeRotation: true }));
  expect(js).toContain(".body.setAllowRotation(false)");
  expect(js).not.toContain("setAngularVelocity");
  expect(js).not.toContain("setAngularDrag");
});

test("a body at the defaults exports no angular setters", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, BODY({ angularVelocity: 0, angularDrag: 0, freezeRotation: false }));
  expect(js).toContain("this.physics.add.existing"); // the body is still created
  expect(js).not.toContain("setAngularVelocity");
  expect(js).not.toContain("setAngularDrag");
  expect(js).not.toContain("setAllowRotation");
});

test("a negative angular velocity exports (clockwise) but a non-positive angular drag does not", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, BODY({ angularVelocity: -90, angularDrag: -1 }));
  expect(js).toContain(".body.setAngularVelocity(-90)");
  expect(js).not.toContain("setAngularDrag"); // angularDrag <= 0 → suppressed (Phaser would mis-handle it)
});

test("angular velocity + drag + freeze rotation survive a .jouer round-trip", async ({ page }) => {
  const r = await page.evaluate((body) => {
    const { cmd, store, jouer } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const b = scene.objects.find((o: any) => o.id === id).body;
    return { av: b.angularVelocity, ad: b.angularDrag, fr: b.freezeRotation };
  }, BODY({ angularVelocity: 270, angularDrag: 1.5, freezeRotation: true }));
  expect(r).toEqual({ av: 270, ad: 1.5, fr: true });
});
