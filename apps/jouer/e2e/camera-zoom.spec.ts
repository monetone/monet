import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Main Camera Zoom (an orthographic-size analogue): a per-scene
// camera zoom for the played/exported game. Like scene gravity it is game/export
// only — the editor viewport has its own zoom — so specs assert the model, the
// .jouer round-trip and the exported Phaser code. Under the `desktop` project the
// last test doubles as the CSP smoke.

const setZoom = (page: Page, z: number) =>
  page.evaluate((z) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, { cameraZoom: z });
  }, z);

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("camera zoom is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await setZoom(page, 2);
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId).cameraZoom;
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    return { live, back: back.scenes.find((s: any) => s.id === back.activeSceneId).cameraZoom };
  });
  expect(r).toEqual({ live: 2, back: 2 });
});

test("the exported game zooms the main camera", async ({ page }) => {
  await setZoom(page, 2);
  expect(await exportJs(page)).toContain("this.cameras.main.setZoom(2)");
});

test("a default-zoom scene exports no setZoom", async ({ page }) => {
  // Fresh project: cameraZoom defaults to 1 → no camera zoom emitted.
  expect(await exportJs(page)).not.toContain("setZoom");
});

test("camera zoom runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await setZoom(page, 1.5);
  // The editor viewport is unaffected; just confirm no errors/violations.
  expect(await page.evaluate(() => window.__mj.store.getProject().scenes[0].cameraZoom)).toBe(1.5);
  expect(await cspViolations(page)).toEqual([]);
});
