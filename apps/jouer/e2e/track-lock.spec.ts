import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Animation Track Lock (Unity Timeline track lock): a locked track
// still plays/exports but is read-only — every keyframe/track edit becomes a no-op
// until unlocked. Specs seed a 2-keyframe track on the active timeline, lock it,
// and assert each edit command is blocked. Under the `desktop` project the last
// test doubles as the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

async function seedTrack(page: Page): Promise<{ id: string; trackId: string }> {
  return page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 100 });
    const trackId = "trk_lock_test";
    store.mutate("seed track", (d: any) => {
      const scene = d.scenes.find((s: any) => s.id === d.activeSceneId);
      const tl = scene.timelines.find((t: any) => t.id === scene.activeTimelineId) ?? scene.timelines[0];
      tl.tracks.push({ id: trackId, targetId: id, property: "x", keyframes: [
        { id: "kf0", time: 0, value: 0, ease: "linear" },
        { id: "kf1", time: 1, value: 200, ease: "linear" },
      ] });
    });
    return { id, trackId };
  });
}

const trackState = (page: Page, trackId: string) =>
  page.evaluate((trackId) => {
    const { store, query } = window.__mj;
    const scene = query.activeScene(store.getProject());
    for (const tl of scene.timelines) {
      const t = tl.tracks.find((t: any) => t.id === trackId);
      if (t) return { exists: true, locked: t.locked, kfCount: t.keyframes.length, kf0: t.keyframes.find((k: any) => k.id === "kf0")?.value };
    }
    return { exists: false, locked: undefined, kfCount: 0, kf0: undefined };
  }, trackId);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a locked track blocks every keyframe/track edit", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  await page.evaluate((trackId) => {
    const { cmd, store } = window.__mj;
    cmd.setTrackLocked(trackId, true);
    store.setPlayhead(0.5); // between the two keys, so an add would create a 3rd
    cmd.updateKeyframe(trackId, "kf0", { value: 999 }); // blocked
    cmd.keyframeAtPlayhead(trackId); // blocked (would add a 3rd key)
    cmd.copyKeyframe(trackId, "kf1");
    cmd.pasteKeyframe(trackId); // blocked
    cmd.deleteKeyframe(trackId, "kf0"); // blocked
    cmd.removeTrack(trackId); // blocked
    // the keyframe drag path (live + commit) and setTrackKeyframes are blocked too
    const replacement = [{ id: "kf0", time: 0, value: 0, ease: "linear" }]; // would collapse to 1 key
    cmd.liveTrackKeyframes(trackId, replacement);
    cmd.commitTrackKeyframes(trackId, replacement);
    cmd.setTrackKeyframes(trackId, replacement);
  }, trackId);
  expect(await trackState(page, trackId)).toEqual({ exists: true, locked: true, kfCount: 2, kf0: 0 });
});

test("unlocking re-enables editing", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  await page.evaluate((trackId) => {
    const { cmd } = window.__mj;
    cmd.setTrackLocked(trackId, true);
    cmd.deleteKeyframe(trackId, "kf0"); // blocked while locked
    cmd.setTrackLocked(trackId, false);
    cmd.deleteKeyframe(trackId, "kf0"); // now works
  }, trackId);
  const s = await trackState(page, trackId);
  expect(s.locked).toBeUndefined(); // flag deleted on unlock (no locked:false)
  expect(s.kfCount).toBe(1); // the delete went through after unlocking
});

test("a locked track still exports its tween (lock is not mute)", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  await page.evaluate((trackId) => window.__mj.cmd.setTrackLocked(trackId, true), trackId);
  expect(await exportJs(page)).toContain("this.tweens.chain("); // locked tracks still play
});

test("the animation-panel lock toggle locks the track in the model", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  await page.getByTestId("track-lock").first().click();
  expect((await trackState(page, trackId)).locked).toBe(true);
});

test("track lock runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  await page.evaluate((trackId) => window.__mj.cmd.setTrackLocked(trackId, true), trackId);
  expect((await trackState(page, trackId)).locked).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
