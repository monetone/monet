// Real-pointer timeline interaction: drag-to-move (incl. linked A/V sync and
// cross-track moves) and drag-to-trim, driven through the actual clip DOM.
import { test, expect } from "@playwright/test";
import { gotoApp, importFixture } from "./helpers";
import { clipInfo, dragClipByFrames, dragClipToTrack, dragTrim, placeOnTimeline, setPxPerFrame, setSnapping, videoTrackIds } from "./pointer";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await importFixture(page, "bars.webm"); // video on V1 + linked audio on A1
  const media = await page.evaluate(() => (window as any).__mc.store.getProject().media[0].id);
  await placeOnTimeline(page, media);
  // Keep the clip + all drag targets inside the (narrow, ~436px) e2e timeline
  // lane: at higher zoom the clip overflows the lane and handles fall under
  // adjacent panels. 4 px/frame keeps a 46-frame clip ~184px wide.
  await setPxPerFrame(page, 4);
  await setSnapping(page, false); // deterministic landing for exact-position asserts
});

test("dragging a clip body moves it along the same track", async ({ page }) => {
  const ids = await placeIds(page);
  const before = (await clipInfo(page, ids.video))!;
  await dragClipByFrames(page, ids.video, 40);
  const after = (await clipInfo(page, ids.video))!;
  expect(after.start).toBeGreaterThan(before.start + 30);
  expect(after.start).toBeLessThanOrEqual(before.start + 42);
  expect(after.trackName).toBe(before.trackName); // same track
});

test("moving a video clip carries its linked audio clip in sync", async ({ page }) => {
  const ids = await placeIds(page);
  expect(ids.audio).toBeTruthy();
  await dragClipByFrames(page, ids.video, 50);
  const v = (await clipInfo(page, ids.video))!;
  const a = (await clipInfo(page, ids.audio!))!;
  expect(v.start).toBeGreaterThan(5); // actually moved
  expect(a.start).toBe(v.start); // audio followed video exactly
  expect(a.trackKind).toBe("audio"); // stayed on its own (audio) track
});

test("a video clip can be dragged onto another video track", async ({ page }) => {
  const ids = await placeIds(page);
  const vts = await videoTrackIds(page); // [V1, V2, V3]
  await dragClipToTrack(page, ids.video, vts[1], 20); // → V2 at ~frame 20
  const v = (await clipInfo(page, ids.video))!;
  expect(v.trackId).toBe(vts[1]);
  expect(v.start).toBeGreaterThan(12);
  expect(v.start).toBeLessThanOrEqual(22);
});

test("dragging the right trim handle shortens the clip", async ({ page }) => {
  const ids = await placeIds(page);
  const before = (await clipInfo(page, ids.video))!;
  await dragTrim(page, ids.video, "end", -12);
  const after = (await clipInfo(page, ids.video))!;
  expect(after.start).toBe(before.start); // start unchanged
  expect(after.duration).toBeLessThan(before.duration);
  expect(Math.abs(after.duration - (before.duration - 12))).toBeLessThanOrEqual(2);
});

test("dragging the left trim handle moves the in-point", async ({ page }) => {
  const ids = await placeIds(page);
  const before = (await clipInfo(page, ids.video))!;
  await dragTrim(page, ids.video, "start", 10);
  const after = (await clipInfo(page, ids.video))!;
  expect(after.start).toBeGreaterThan(before.start); // head pulled in
  expect(after.duration).toBeLessThan(before.duration);
  expect(after.inPoint).toBeGreaterThan(before.inPoint); // source in-point advanced
});

// Re-derive the placed clip ids fresh per test (page reloaded in beforeEach).
async function placeIds(page: import("@playwright/test").Page): Promise<{ video: string; audio?: string }> {
  return page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    let video = "", audio: string | undefined;
    for (const t of seq.tracks) for (const c of t.clips) {
      if (t.kind === "video" && !video) video = c.id;
      if (t.kind === "audio" && !audio) audio = c.id;
    }
    return { video, audio };
  });
}
