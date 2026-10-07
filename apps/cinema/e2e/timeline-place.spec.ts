import { test, expect } from "@playwright/test";
import { gotoApp, importFixture, allClips, trackClipCounts } from "./helpers";
import { placeOnTimeline, setPxPerFrame, setSnapping, videoTrackIds } from "./pointer";

// Tests for clip placement via cmd.addMediaAt (the bin→timeline drop command).
// All assertions are model-only (allClips / trackClipCounts / store reads).

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await importFixture(page, "bars.webm");
  const media = await page.evaluate(() => (window as any).__mc.store.getProject().media[0].id);
  await placeOnTimeline(page, media);
  await setPxPerFrame(page, 4);
  await setSnapping(page, false);
});

// ---------------------------------------------------------------------------
// 1. Overwrite: place a second copy starting at frame 20 without ripple.
//    The new clip (B) must start at 20, and no two video clips may occupy
//    the same frame (overwrite means the region is replaced, not stacked).
// ---------------------------------------------------------------------------
test("overwrite: addMediaAt places clip B at frame 20 with no overlapping video frames", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const project = mc.store.getProject();
    const mediaId = project.media[0].id;
    const seq = mc.query.activeSequence(project);
    const v1 = seq.tracks.find((t: any) => t.kind === "video");

    mc.cmd.addMediaAt(mediaId, v1.id, 20, false);

    const fresh = mc.query.activeSequence(mc.store.getProject());
    const vTrack = fresh.tracks.find((t: any) => t.kind === "video");
    const clips = [...vTrack.clips].sort((a: any, b: any) => a.start - b.start);

    // Find clip B (the one starting at 20).
    const clipB = clips.find((c: any) => c.start === 20);

    // Check for frame-level overlaps among all video clips.
    let overlap = false;
    for (let i = 0; i < clips.length && !overlap; i++) {
      for (let j = i + 1; j < clips.length && !overlap; j++) {
        const a = clips[i];
        const b = clips[j];
        const aEnd = a.start + a.duration;
        const bEnd = b.start + b.duration;
        if (a.start < bEnd && b.start < aEnd) overlap = true;
      }
    }

    return {
      clipBStart: clipB?.start ?? null,
      clipBDuration: clipB?.duration ?? null,
      videoClipCount: clips.length,
      overlap,
    };
  });

  expect(r.clipBStart).toBe(20);
  expect(r.clipBDuration).toBeGreaterThan(0);
  expect(r.overlap).toBe(false);
});

// ---------------------------------------------------------------------------
// 2. Ripple insert: addMediaAt with ripple=true at frame 10 pushes existing
//    content to the right. A clip that was at start 0 should either be split
//    and/or a clip now has a start > the original end.
// ---------------------------------------------------------------------------
test("ripple insert: addMediaAt with ripple=true pushes existing clip to the right", async ({ page }) => {
  // First capture the original state (one clip at start 0).
  const before = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const v1 = seq.tracks.find((t: any) => t.kind === "video");
    const clips = [...v1.clips].sort((a: any, b: any) => a.start - b.start);
    // Total occupied duration = last clip end.
    const lastEnd = clips.reduce((max: number, c: any) => Math.max(max, c.start + c.duration), 0);
    return { clipCount: clips.length, firstStart: clips[0].start, lastEnd };
  });

  expect(before.clipCount).toBe(1);
  expect(before.firstStart).toBe(0);

  const after = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const project = mc.store.getProject();
    const mediaId = project.media[0].id;
    const seq = mc.query.activeSequence(project);
    const v1 = seq.tracks.find((t: any) => t.kind === "video");

    mc.cmd.addMediaAt(mediaId, v1.id, 10, true);

    const fresh = mc.query.activeSequence(mc.store.getProject());
    const vTrack = fresh.tracks.find((t: any) => t.kind === "video");
    const clips = [...vTrack.clips].sort((a: any, b: any) => a.start - b.start);
    const lastEnd = clips.reduce((max: number, c: any) => Math.max(max, c.start + c.duration), 0);
    const maxStart = clips.reduce((max: number, c: any) => Math.max(max, c.start), 0);
    return { clipCount: clips.length, lastEnd, maxStart, insertedStart: clips.find((c: any) => c.start === 10)?.start ?? null };
  });

  // Total duration grew (inserted media was added, not replaced).
  expect(after.lastEnd).toBeGreaterThan(before.lastEnd);
  // A clip exists at the insertion point.
  expect(after.insertedStart).toBe(10);
  // A clip starts later than the original clip end (was pushed right).
  expect(after.maxStart).toBeGreaterThan(before.lastEnd - 1);
});

// ---------------------------------------------------------------------------
// 3. Back-to-back: place the same media twice by advancing the playhead to
//    the sequence end between insertions. The two clips should be adjacent
//    on V1 (gap = 0 between them) and cover twice the single-clip duration.
// ---------------------------------------------------------------------------
test("back-to-back: two addMediaToTimeline calls produce adjacent clips with no gap", async ({ page }) => {
  // The beforeEach already placed clip A (start 0). We place clip B at the
  // end of clip A using the sequence duration as the next start frame.
  const r = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const project = mc.store.getProject();
    const mediaId = project.media[0].id;

    // Determine end of current content on V1.
    const seq1 = mc.query.activeSequence(project);
    const v1 = seq1.tracks.find((t: any) => t.kind === "video");
    const clipA = v1.clips[0];
    const endOfA = clipA.start + clipA.duration;

    // Place clip B immediately after A by setting the playhead there and
    // using addMediaAt (ripple=false so nothing shifts).
    mc.cmd.addMediaAt(mediaId, v1.id, endOfA, false);

    const fresh = mc.query.activeSequence(mc.store.getProject());
    const vTrack = fresh.tracks.find((t: any) => t.kind === "video");
    const sorted = [...vTrack.clips].sort((a: any, b: any) => a.start - b.start);

    const gap = sorted.length >= 2 ? sorted[1].start - (sorted[0].start + sorted[0].duration) : null;
    return {
      clipCount: sorted.length,
      clipAStart: sorted[0].start,
      clipADuration: sorted[0].duration,
      clipBStart: sorted[1]?.start ?? null,
      clipBDuration: sorted[1]?.duration ?? null,
      gap,
    };
  });

  expect(r.clipCount).toBeGreaterThanOrEqual(2);
  expect(r.clipAStart).toBe(0);
  // B starts exactly where A ends.
  expect(r.clipBStart).toBe(r.clipAStart + r.clipADuration);
  // Gap is zero.
  expect(r.gap).toBe(0);
  // Both clips have positive durations.
  expect(r.clipADuration).toBeGreaterThan(0);
  expect(r.clipBDuration).toBeGreaterThan(0);
});
