import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Animation Track Solo (Unity Timeline track solo): while any track is
// soloed, only soloed (non-muted) tracks drive their targets. Routed through the same
// activeTracks helper as mute, so the editor preview, player and export all honour it.
// Specs seed two tracks on one object, toggle solo, and assert the exported tweens +
// the model. Under the `desktop` project the last test doubles as the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

// Seed a rectangle with an x-track (value 200) and a y-track (value 150) on the active
// timeline; returns the object + track ids.
async function seedTwoTracks(page: Page): Promise<{ id: string; xt: string; yt: string }> {
  return page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    const xt = "trk_x", yt = "trk_y";
    store.mutate("seed tracks", (d: any) => {
      const scene = d.scenes.find((s: any) => s.id === d.activeSceneId);
      const tl = scene.timelines.find((t: any) => t.id === scene.activeTimelineId) ?? scene.timelines[0];
      tl.tracks.push(
        { id: xt, targetId: id, property: "x", keyframes: [{ id: "kx0", time: 0, value: 0, ease: "linear" }, { id: "kx1", time: 1, value: 200, ease: "linear" }] },
        { id: yt, targetId: id, property: "y", keyframes: [{ id: "ky0", time: 0, value: 0, ease: "linear" }, { id: "ky1", time: 1, value: 150, ease: "linear" }] },
      );
    });
    return { id, xt, yt };
  });
}

const soloOf = (page: Page, trackId: string) =>
  page.evaluate((trackId) => {
    const { store, query } = window.__mj;
    const scene = query.activeScene(store.getProject());
    for (const tl of scene.timelines) {
      const t = tl.tracks.find((t: any) => t.id === trackId);
      if (t) return t.solo;
    }
    return undefined;
  }, trackId);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("soloing a track exports only that track; clearing solo restores both", async ({ page }) => {
  const { xt } = await seedTwoTracks(page);
  const both = await exportJs(page); // nothing soloed → both tracks export
  expect(both).toContain("{ x: 200");
  expect(both).toContain("{ y: 150");

  await page.evaluate((xt) => window.__mj.cmd.setTrackSolo(xt, true), xt);
  expect(await soloOf(page, xt)).toBe(true);
  const soloed = await exportJs(page);
  expect(soloed).toContain("{ x: 200"); // soloed x still exports
  expect(soloed).not.toContain("{ y: 150"); // y is silenced

  await page.evaluate((xt) => window.__mj.cmd.setTrackSolo(xt, false), xt);
  expect(await soloOf(page, xt)).toBeUndefined(); // flag deleted (no solo:false)
  expect(await exportJs(page)).toContain("{ y: 150"); // both export again
});

test("the animation-panel solo toggle solos the track in the model", async ({ page }) => {
  const { xt } = await seedTwoTracks(page);
  await page.getByTestId("track-solo").first().click();
  expect(await soloOf(page, xt)).toBe(true);
});

test("track solo runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const { xt } = await seedTwoTracks(page);
  await page.evaluate((xt) => window.__mj.cmd.setTrackSolo(xt, true), xt);
  expect(await soloOf(page, xt)).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
