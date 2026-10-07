import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Camera Follow Offset (Cinemachine Transposer "Follow Offset" /
// Framing Transposer "Tracked Object Offset"): displaces the played/exported
// main camera from its follow target via Phaser startFollow's offsetX/offsetY
// (args 5-6). Like the rest of the follow rig it is game/export only — the
// editor viewport is its own camera — so specs assert the model, the .jouer
// round-trip and the exported code. Under `desktop` the last test is the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

// Add a follow target, point the camera at it, and apply the given scene patch.
async function seedFollow(page: Page, patch: Record<string, unknown>): Promise<string> {
  return page.evaluate((patch) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { patch: { name: "Hero" } });
    cmd.updateScene(store.getProject().activeSceneId, { cameraFollowId: id, ...patch });
    return id;
  }, patch);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the follow offset is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await seedFollow(page, { cameraFollowOffsetX: 40, cameraFollowOffsetY: -25 });
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return {
      live: { x: live.cameraFollowOffsetX, y: live.cameraFollowOffsetY },
      back: { x: bs.cameraFollowOffsetX, y: bs.cameraFollowOffsetY },
    };
  });
  expect(r).toEqual({ live: { x: 40, y: -25 }, back: { x: 40, y: -25 } });
});

test("the exported game passes the offset as startFollow args 5-6", async ({ page }) => {
  await seedFollow(page, { cameraFollowOffsetX: 40, cameraFollowOffsetY: -25 });
  const js = await exportJs(page);
  expect(js).toContain("this.cameras.main.startFollow(");
  expect(js).toContain(", false, 1, 1, 40, -25)"); // default lerp 1 + offset → full 6-arg form
});

test("a following scene with no offset emits no trailing offset args", async ({ page }) => {
  await seedFollow(page, {}); // follow, default lerp 1, offset 0,0
  const js = await exportJs(page);
  expect(js).toContain("startFollow(");
  expect(js).not.toContain(", false,"); // plain 1-arg follow — no lerp/offset args
});

test("camera follow offset runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await seedFollow(page, { cameraFollowOffsetX: -10, cameraFollowOffsetY: 60 });
  expect(await page.evaluate(() => {
    const s = window.__mj.store.getProject().scenes[0];
    return { x: s.cameraFollowOffsetX, y: s.cameraFollowOffsetY };
  })).toEqual({ x: -10, y: 60 });
  expect(await cspViolations(page)).toEqual([]);
});
