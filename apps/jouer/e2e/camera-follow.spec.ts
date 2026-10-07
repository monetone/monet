import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Camera Follow (Cinemachine Virtual Camera "Follow"): the played /
// exported game's main camera tracks a chosen object via Phaser camera.startFollow.
// Like camera zoom/scroll it is game/export only — the editor viewport is its own
// camera — so specs assert the model, the .jouer round-trip and the exported code.
// Under the `desktop` project the last test doubles as the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));
const setFollow = (page: Page, id: string | null) =>
  page.evaluate((id) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, { cameraFollowId: id });
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("camera follow id is preserved in the model and round-trips through .jouer", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Hero" } }));
  await setFollow(page, id);
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live: live.cameraFollowId, back: bs.cameraFollowId };
  });
  expect(r).toEqual({ live: id, back: id });
});

test("the exported game follows the target object", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Hero" } }));
  await setFollow(page, id);
  expect(await exportJs(page)).toContain("this.cameras.main.startFollow(");
});

test("a default scene (no follow) emits no startFollow", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.addObject("rectangle"));
  expect(await exportJs(page)).not.toContain("startFollow");
});

test("clearing the follow target removes the startFollow call", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Hero" } }));
  await setFollow(page, id);
  expect(await exportJs(page)).toContain("startFollow");
  await setFollow(page, null);
  expect(await exportJs(page)).not.toContain("startFollow");
});

test("camera follow runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Hero" } }));
  await setFollow(page, id);
  expect(await page.evaluate(() => window.__mj.store.getProject().scenes[0].cameraFollowId)).toBe(id);
  expect(await cspViolations(page)).toEqual([]);
});
