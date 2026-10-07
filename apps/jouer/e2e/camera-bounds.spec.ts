import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Camera Bounds / Confiner (Cinemachine Confiner 2D): confine the
// played/exported main camera to the scene rect via Phaser camera.setBounds so a
// following camera never shows past the level edge. Like camera zoom/scroll/follow
// it is game/export only — the editor viewport is its own camera — so specs assert
// the model, the .jouer round-trip and the exported code. The last test is the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));
const setBounds = (page: Page, on: boolean) =>
  page.evaluate((on) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, { cameraBounds: on });
  }, on);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("cameraBounds is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await setBounds(page, true);
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live: live.cameraBounds, back: bs.cameraBounds };
  });
  expect(r).toEqual({ live: true, back: true });
});

test("the exported game confines the main camera to the scene rect", async ({ page }) => {
  await setBounds(page, true);
  const r = await page.evaluate(() => {
    const s = window.__mj.store.getProject().scenes[0];
    return { w: s.width, h: s.height };
  });
  expect(await exportJs(page)).toContain(`this.cameras.main.setBounds(0, 0, ${r.w}, ${r.h});`);
});

test("a default scene emits no camera bounds (distinct from the physics world bounds)", async ({ page }) => {
  expect(await exportJs(page)).not.toContain("this.cameras.main.setBounds(");
});

test("disabling cameraBounds removes the camera setBounds call", async ({ page }) => {
  await setBounds(page, true);
  expect(await exportJs(page)).toContain("this.cameras.main.setBounds(");
  await setBounds(page, false);
  expect(await exportJs(page)).not.toContain("this.cameras.main.setBounds(");
});

test("camera bounds runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await setBounds(page, true);
  expect(await page.evaluate(() => window.__mj.store.getProject().scenes[0].cameraBounds)).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
