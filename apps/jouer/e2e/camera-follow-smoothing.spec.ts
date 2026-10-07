import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Camera Follow smoothing (Cinemachine Virtual Camera Follow damping):
// the played/exported main camera eases toward the follow target instead of snapping,
// via the lerp args of Phaser camera.startFollow. 1 = instant (default), lower = smoother.
// Like the other camera fields it is game/export only — specs assert the model, the
// .jouer round-trip and the exported code. The last test doubles as the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));
const setScene = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((patch) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, patch);
  }, patch);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a follow lerp below 1 emits a smoothed startFollow", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Hero" } }));
  await setScene(page, { cameraFollowId: id, cameraFollowLerp: 0.2 });
  const js = await exportJs(page);
  expect(js).toContain("this.cameras.main.startFollow(");
  expect(js).toContain(", false, 0.2, 0.2);");
});

test("the default lerp of 1 emits the plain (instant) startFollow", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Hero" } }));
  await setScene(page, { cameraFollowId: id });
  const js = await exportJs(page);
  expect(js).toContain("this.cameras.main.startFollow(");
  expect(js).not.toContain(", false,");
});

test("cameraFollowLerp is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await setScene(page, { cameraFollowLerp: 0.35 });
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live: live.cameraFollowLerp, back: bs.cameraFollowLerp };
  });
  expect(r).toEqual({ live: 0.35, back: 0.35 });
});

test("camera follow smoothing runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Hero" } }));
  await setScene(page, { cameraFollowId: id, cameraFollowLerp: 0.5 });
  expect(await exportJs(page)).toContain(", false, 0.5, 0.5);");
  expect(await cspViolations(page)).toEqual([]);
});
