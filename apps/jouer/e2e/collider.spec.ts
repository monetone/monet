import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity 2D collider shape: a physics body is a Box collider by default
// (Phaser's rectangular body) or a Circle collider (Unity's BoxCollider2D vs
// CircleCollider2D), which exports a Phaser body.setCircle(...) sized to the
// object. Specs drive the live editor through `window.__mj` and assert the
// model + the exported code. Under the `desktop` project (shipped bundle + Tauri
// CSP) this doubles as the feature's CSP smoke.

// Build a full arcade body with the given collider shape (runs in the page).
const PAGE_BODY = (shape: "box" | "circle") => ({
  bodyType: "dynamic", shape,
  velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0,
  collideWorldBounds: false, immovable: false, allowGravity: true,
});

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("setting the collider shape to circle updates the model", async ({ page }) => {
  const shape = await page.evaluate((body) => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("ellipse");
    cmd.updateObject(id, { body });
    return query.findObject(query.activeScene(store.getProject()), id).body.shape;
  }, PAGE_BODY("circle"));
  expect(shape).toBe("circle");
});

test("a circle collider exports a setCircle body fitted + centred to the object", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("ellipse", { x: 100, y: 100 }); // ellipse defaults to 100×100
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, PAGE_BODY("circle"));
  expect(js).toContain(".body.setCircle(50, 0, 0)"); // radius 50, centred
});

test("a box collider exports a body but no setCircle", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, PAGE_BODY("box"));
  expect(js).toContain("this.physics.add.existing"); // the body is still created
  expect(js).not.toContain("setCircle");
});

test("a non-square circle collider centres with an offset", async ({ page }) => {
  const js = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 }); // 120×80 default
    cmd.updateObject(id, { body });
    return window.__mj.exporter.exportGameJs(store.getProject());
  }, PAGE_BODY("circle"));
  expect(js).toContain(".body.setCircle(40, 20, 0)"); // radius 40, offsetX 20
});

test("the collider shape survives a .jouer round-trip", async ({ page }) => {
  const shape = await page.evaluate((body) => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("ellipse");
    cmd.updateObject(id, { body });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return scene.objects.find((o: any) => o.id === id).body.shape;
  }, PAGE_BODY("circle"));
  expect(shape).toBe("circle");
});

test("collider shape runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("ellipse", { x: 100, y: 100 });
    cmd.updateObject(id, { body });
    return id;
  }, PAGE_BODY("circle"));
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
