import { test, expect } from "@playwright/test";
import { allClips, gotoApp, importFixture, trackClipCounts } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  // Import a clip and lay it on the timeline (video on V1 + linked audio on A1).
  await importFixture(page, "bars.webm");
  await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const m = mc.store.getProject().media[0];
    mc.cmd.addMediaToTimeline(m.id);
  });
});

test("places a clip on V1 with a linked audio clip on A1", async ({ page }) => {
  const counts = await trackClipCounts(page);
  expect(counts.video[0]).toBe(1);
  expect(counts.audio[0]).toBe(1);
});

test("razor splits the clip; undo/redo restores it", async ({ page }) => {
  await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    mc.store.setPlayhead(12);
    mc.cmd.razorAtPlayhead(true);
  });
  let counts = await trackClipCounts(page);
  expect(counts.video[0]).toBe(2);
  expect(counts.audio[0]).toBe(2);

  await page.evaluate(() => (window as any).__mc.store.undo());
  counts = await trackClipCounts(page);
  expect(counts.video[0]).toBe(1);

  await page.evaluate(() => (window as any).__mc.store.redo());
  counts = await trackClipCounts(page);
  expect(counts.video[0]).toBe(2);
});

test("ripple delete closes the gap", async ({ page }) => {
  // Split into two, then ripple-delete the first half; the second should slide to 0.
  const secondStart = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    mc.store.setPlayhead(12);
    mc.cmd.razorAtPlayhead(true);
    const seq = mc.query.activeSequence(mc.store.getProject());
    const v1 = seq.tracks.find((t: any) => t.kind === "video");
    const sorted = [...v1.clips].sort((a: any, b: any) => a.start - b.start);
    mc.store.select([sorted[0].id]);
    mc.cmd.rippleDeleteSelected();
    const after = mc.query.activeSequence(mc.store.getProject()).tracks.find((t: any) => t.kind === "video");
    return after.clips[0].start;
  });
  expect(secondStart).toBe(0);
});

test("trim shortens a clip; move repositions it", async ({ page }) => {
  const clips = await allClips(page);
  const v = clips.find((c) => c.trackKind === "video")!;
  const before = v.duration;

  const trimmed = await page.evaluate((id) => {
    const mc: any = (window as any).__mc;
    mc.cmd.trimClip(id, "end", -5);
    const seq = mc.query.activeSequence(mc.store.getProject());
    return mc.query.findClip(seq, id).clip.duration;
  }, v.id);
  expect(trimmed).toBe(before - 5);

  const moved = await page.evaluate((id) => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const track = mc.query.findClip(seq, id).track;
    mc.cmd.moveClipTo(id, track.id, 100);
    return mc.query.findClip(mc.query.activeSequence(mc.store.getProject()), id).clip.start;
  }, v.id);
  expect(moved).toBe(100);
});

test("applying a cross-dissolve produces a two-layer composite in its window", async ({ page }) => {
  const specCount = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    // Split so there are two adjacent clips on V1.
    mc.store.setPlayhead(12);
    mc.cmd.razorAtPlayhead(true);
    const seq = mc.query.activeSequence(mc.store.getProject());
    const v1 = seq.tracks.find((t: any) => t.kind === "video");
    const sorted = [...v1.clips].sort((a: any, b: any) => a.start - b.start);
    const incoming = sorted[1];
    mc.store.select([incoming.id]);
    mc.cmd.addTransitionToSelected("cross-dissolve", 8);
    const fresh = mc.query.activeSequence(mc.store.getProject());
    const inc = mc.query.findClip(fresh, incoming.id).clip;
    // Sample a frame a few frames into the incoming clip's head transition.
    return {
      kind: inc.transitionIn?.kind,
      layers: mc.playback.collectVideoSpecs(fresh, inc.start + 2).length,
    };
  });
  expect(specCount.kind).toBe("cross-dissolve");
  expect(specCount.layers).toBe(2);
});

test("Lumetri grade enables on a selected clip", async ({ page }) => {
  const grade = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const v1 = seq.tracks.find((t: any) => t.kind === "video");
    mc.store.select([v1.clips[0].id]);
    mc.cmd.editSelectedClips("Saturation", (c: any) => {
      c.color.enabled = true;
      c.color.saturation = 0.5;
    });
    const clip = mc.query.findClip(mc.query.activeSequence(mc.store.getProject()), v1.clips[0].id).clip;
    return { enabled: clip.color.enabled, sat: clip.color.saturation };
  });
  expect(grade.enabled).toBe(true);
  expect(grade.sat).toBeCloseTo(0.5, 5);
});
