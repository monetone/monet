import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Animation Track Mute (Unity Timeline track mute): a muted track
// keeps its keyframes but drives nothing — skipped by the editor preview, the
// player and the export. Specs drive window.__mj (seed a 2-keyframe track on the
// active timeline, toggle mute) and assert the model + the exported code; one test
// drives the animation-panel mute toggle. Under `desktop` the last test is the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

// Seed a rectangle + a 2-keyframe x-track on the active timeline; returns ids.
async function seedTrack(page: Page): Promise<{ id: string; trackId: string }> {
  return page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 100 });
    const trackId = "trk_mute_test";
    store.mutate("seed track", (d: any) => {
      const scene = d.scenes.find((s: any) => s.id === d.activeSceneId);
      const tl = scene.timelines.find((t: any) => t.id === scene.activeTimelineId) ?? scene.timelines[0];
      tl.tracks.push({ id: trackId, targetId: id, property: "x", keyframes: [
        { id: "k0", time: 0, value: 0, ease: "linear" },
        { id: "k1", time: 1, value: 200, ease: "linear" },
      ] });
    });
    return { id, trackId };
  });
}

const trackMuted = (page: Page, trackId: string) =>
  page.evaluate((trackId) => {
    const { store, query } = window.__mj;
    const scene = query.activeScene(store.getProject());
    for (const tl of scene.timelines) {
      const t = tl.tracks.find((t: any) => t.id === trackId);
      if (t) return t.muted;
    }
    return undefined;
  }, trackId);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("muting a track removes its tween from the export; unmuting restores it", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  expect(await exportJs(page)).toContain("this.tweens.chain("); // active → a tween chain

  await page.evaluate((trackId) => window.__mj.cmd.setTrackMuted(trackId, true), trackId);
  expect(await trackMuted(page, trackId)).toBe(true);
  expect(await exportJs(page)).not.toContain("this.tweens.chain("); // muted → no chain

  await page.evaluate((trackId) => window.__mj.cmd.setTrackMuted(trackId, false), trackId);
  expect(await trackMuted(page, trackId)).toBeUndefined(); // flag deleted (no muted:false)
  expect(await exportJs(page)).toContain("this.tweens.chain("); // restored
});

test("the animation-panel mute toggle mutes the track in the model", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  await page.getByTestId("track-mute").click();
  expect(await trackMuted(page, trackId)).toBe(true);
});

test("track mute runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const { trackId } = await seedTrack(page);
  await page.evaluate((trackId) => window.__mj.cmd.setTrackMuted(trackId, true), trackId);
  expect(await trackMuted(page, trackId)).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
