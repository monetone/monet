import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Camera Dead Zone (Cinemachine framing dead zone): the follow target
// moves freely within a centred rect before the played/exported camera pans, via
// Phaser camera.setDeadzone. Like the other camera fields it is game/export only —
// the editor viewport is its own camera — so specs assert the model, the .jouer
// round-trip and the exported code. The last test doubles as the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));
const setDeadzone = (page: Page, w: number, h: number) =>
  page.evaluate(({ w, h }) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, { cameraDeadzoneW: w, cameraDeadzoneH: h });
  }, { w, h });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the dead-zone size is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await setDeadzone(page, 200, 120);
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live: { w: live.cameraDeadzoneW, h: live.cameraDeadzoneH }, back: { w: bs.cameraDeadzoneW, h: bs.cameraDeadzoneH } };
  });
  expect(r).toEqual({ live: { w: 200, h: 120 }, back: { w: 200, h: 120 } });
});

test("the exported game sets the camera dead zone", async ({ page }) => {
  await setDeadzone(page, 200, 120);
  expect(await exportJs(page)).toContain("this.cameras.main.setDeadzone(200, 120);");
});

test("a default scene emits no setDeadzone", async ({ page }) => {
  expect(await exportJs(page)).not.toContain("setDeadzone");
});

test("clearing the dead zone (0,0) removes the setDeadzone call", async ({ page }) => {
  await setDeadzone(page, 200, 120);
  expect(await exportJs(page)).toContain("setDeadzone");
  await setDeadzone(page, 0, 0);
  expect(await exportJs(page)).not.toContain("setDeadzone");
});

test("camera dead zone runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await setDeadzone(page, 160, 80);
  expect(await exportJs(page)).toContain("this.cameras.main.setDeadzone(160, 80);");
  expect(await cspViolations(page)).toEqual([]);
});
