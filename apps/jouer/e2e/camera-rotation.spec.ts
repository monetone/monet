import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Camera Rotation / Dutch Angle (Cinemachine Lens "Dutch"): a
// per-scene main-camera roll, in degrees, for the played/exported game. Like
// scene gravity, camera zoom and camera scroll it is game/export only — the
// editor viewport is its own camera — so specs assert the model, the .jouer
// round-trip and the exported Phaser code (degrees → radians). Under the
// `desktop` project the last test doubles as the CSP smoke.

const setRotation = (page: Page, deg: number) =>
  page.evaluate((deg) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, { cameraRotation: deg });
  }, deg);

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

// The exporter rounds the deg→rad value with r2 (3 decimals).
const rad = (deg: number) => Math.round((deg * Math.PI) / 180 * 1000) / 1000;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("camera rotation is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await setRotation(page, 45);
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live: live.cameraRotation, back: bs.cameraRotation };
  });
  expect(r).toEqual({ live: 45, back: 45 });
});

test("the exported game rolls the main camera (degrees → radians)", async ({ page }) => {
  await setRotation(page, 45);
  const js = await exportJs(page);
  expect(js).toContain("this.cameras.main.setRotation(");
  expect(js).toContain(`this.cameras.main.setRotation(${rad(45)})`);
});

test("a default (upright) scene emits no camera-rotation setup", async ({ page }) => {
  // Fresh project: cameraRotation defaults to 0 → no scene setRotation. (setRotation
  // is camera-specific in the export — objects use setAngle — so the bare call is safe
  // to assert absent.)
  expect(await exportJs(page)).not.toContain("this.cameras.main.setRotation(");
});

test("camera rotation runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await setRotation(page, -30);
  expect(await page.evaluate(() => window.__mj.store.getProject().scenes[0].cameraRotation)).toBe(-30);
  expect(await cspViolations(page)).toEqual([]);
});
