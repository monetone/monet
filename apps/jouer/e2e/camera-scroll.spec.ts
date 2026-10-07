import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Main Camera Scroll (Camera position / Phaser camera scroll): a
// per-scene initial camera offset for the played/exported game. Like scene
// gravity + camera zoom it is game/export only — the editor viewport is its own
// camera — so specs assert the model, the .jouer round-trip and the exported
// Phaser code. Under the `desktop` project the last test doubles as the CSP smoke.

const setScroll = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, { cameraX: x, cameraY: y });
  }, { x, y });

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("camera scroll is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await setScroll(page, 120, -40);
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live: { x: live.cameraX, y: live.cameraY }, back: { x: bs.cameraX, y: bs.cameraY } };
  });
  expect(r).toEqual({ live: { x: 120, y: -40 }, back: { x: 120, y: -40 } });
});

test("the exported game scrolls the main camera", async ({ page }) => {
  await setScroll(page, 120, -40);
  expect(await exportJs(page)).toContain("this.cameras.main.setScroll(120, -40)");
});

test("a default (0,0) scene emits no camera-scroll setup", async ({ page }) => {
  // Fresh project: cameraX/cameraY default to 0 → no scene setScroll. (The shared
  // transition helper has its own cam.setScroll, so assert the scene-specific
  // this.cameras.main.setScroll call is absent.)
  expect(await exportJs(page)).not.toContain("this.cameras.main.setScroll(");
});

test("camera scroll runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await setScroll(page, 50, 30);
  expect(await page.evaluate(() => {
    const s = window.__mj.store.getProject().scenes[0];
    return { x: s.cameraX, y: s.cameraY };
  })).toEqual({ x: 50, y: 30 });
  expect(await cspViolations(page)).toEqual([]);
});
