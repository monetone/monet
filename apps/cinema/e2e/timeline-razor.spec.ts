// Real-pointer razor-cut e2e: exercises the razor tool via pointer helpers,
// verifying split count, split boundary, undo, and redo.
import { test, expect } from "@playwright/test";
import { gotoApp, importFixture, allClips, trackClipCounts } from "./helpers";
import { placeOnTimeline, setPxPerFrame, setSnapping, clipInfo, razorAt } from "./pointer";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await importFixture(page, "bars.webm"); // video on V1 + linked audio on A1
  const media = await page.evaluate(() => (window as any).__mc.store.getProject().media[0].id);
  await placeOnTimeline(page, media);
  await setPxPerFrame(page, 4); // keep clips inside the narrow (~436px) e2e lane
  await setSnapping(page, false);
});

/** Get the placed video and audio clip ids from the active sequence. */
async function placedIds(page: import("@playwright/test").Page): Promise<{ video: string; audio?: string }> {
  return page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    let video = "", audio: string | undefined;
    for (const t of seq.tracks) {
      for (const c of t.clips) {
        if (t.kind === "video" && !video) video = c.id;
        if (t.kind === "audio" && !audio) audio = c.id;
      }
    }
    return { video, audio };
  });
}

test("razor cut at frame 20 splits video AND audio tracks into 2 clips each", async ({ page }) => {
  const ids = await placedIds(page);
  expect(ids.video).toBeTruthy();
  expect(ids.audio).toBeTruthy();

  const before = await trackClipCounts(page);
  expect(before.video[0]).toBe(1);
  expect(before.audio[0]).toBe(1);

  await razorAt(page, ids.video, 20);

  const after = await trackClipCounts(page);
  // V1 should now have 2 clips
  expect(after.video[0]).toBe(2);
  // A1 should also have 2 clips (razor cuts all tracks)
  expect(after.audio[0]).toBe(2);
});

test("razor cut at frame 20 places the split boundary at frame 20", async ({ page }) => {
  const ids = await placedIds(page);

  await razorAt(page, ids.video, 20);

  const clips = await allClips(page);
  const videoClips = clips
    .filter((c) => c.trackKind === "video")
    .sort((a, b) => a.start - b.start);

  expect(videoClips).toHaveLength(2);

  const firstClip = videoClips[0];
  const secondClip = videoClips[1];

  // First clip: starts at 0, ends near frame 20 (±4 frame pointer tolerance)
  expect(firstClip.start).toBe(0);
  expect(Math.abs(firstClip.duration - 20)).toBeLessThanOrEqual(4);

  // Second clip: starts near frame 20 (±4 frame pointer tolerance)
  expect(Math.abs(secondClip.start - 20)).toBeLessThanOrEqual(4);

  // The boundary is gapless: end of first == start of second
  expect(Math.abs((firstClip.start + firstClip.duration) - secondClip.start)).toBeLessThanOrEqual(1);
});

test("undo restores 1 video clip; redo restores 2", async ({ page }) => {
  const ids = await placedIds(page);

  // Perform the cut
  await razorAt(page, ids.video, 20);

  const afterCut = await trackClipCounts(page);
  expect(afterCut.video[0]).toBe(2);

  // Undo: should collapse back to 1 clip
  await page.evaluate(() => (window as any).__mc.store.undo());
  // Wait for state to settle
  await page.waitForFunction(
    () => {
      const mc = (window as any).__mc;
      const seq = mc.query.activeSequence(mc.store.getProject());
      const v1 = seq.tracks.find((t: any) => t.kind === "video");
      return v1 && v1.clips.length === 1;
    },
    { timeout: 3_000 },
  );

  const afterUndo = await trackClipCounts(page);
  expect(afterUndo.video[0]).toBe(1);

  // Redo: should restore the 2-clip state
  await page.evaluate(() => (window as any).__mc.store.redo());
  await page.waitForFunction(
    () => {
      const mc = (window as any).__mc;
      const seq = mc.query.activeSequence(mc.store.getProject());
      const v1 = seq.tracks.find((t: any) => t.kind === "video");
      return v1 && v1.clips.length === 2;
    },
    { timeout: 3_000 },
  );

  const afterRedo = await trackClipCounts(page);
  expect(afterRedo.video[0]).toBe(2);
});
