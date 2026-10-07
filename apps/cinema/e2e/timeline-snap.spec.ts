// Edge-snapping e2e: when dragging a clip near another clip's edge, snapping
// should pull the dragged clip's end flush with the neighbour's start.
import { test, expect } from "@playwright/test";
import { gotoApp, importFixture } from "./helpers";
import {
  clipInfo,
  placeOnTimeline,
  setPxPerFrame,
  setSnapping,
  videoTrackIds,
  dragClipByFrames,
} from "./pointer";

// Clip A occupies frames [0..46), clip B occupies [90..136).
// At pxf=4 the snap threshold = 8/4 = 2 frames.
// Dragging clip A right by 44 frames → raw end = 46+44 = 90 = clipB.start.
// With snapping ON  → end snaps flush to 90 → start lands at 90-46 = 44.
// With snapping OFF → raw landing: start=44, end=90 (no gap, but that is the
//   raw result — the point is the code path does not snap, i.e. if we land
//   slightly *short* there is no correction). We test with 43 frames so the
//   raw end=89 < 90, proving no snap correction occurred.

const CLIP_A_DURATION = 46; // bars.webm ≈ 46 frames @24fps
const CLIP_B_START = 90;

test.describe("timeline edge snapping", () => {
  let mediaId: string;
  let clipAId: string;
  let clipBId: string;

  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await importFixture(page, "bars.webm");

    mediaId = await page.evaluate(
      () => (window as any).__mc.store.getProject().media[0].id,
    );

    // Place first clip (clip A) at frame 0 via addMediaToTimeline.
    const placed = await placeOnTimeline(page, mediaId);
    clipAId = placed.video!;

    // Get V1 track id.
    const vts = await videoTrackIds(page);
    const v1Id = vts[0];

    // Place second clip (clip B) at frame 90 on V1, overwrite mode (no ripple).
    clipBId = await page.evaluate(
      ({ mId, trackId, frame }: { mId: string; trackId: string; frame: number }) => {
        const mc = (window as any).__mc;
        mc.cmd.addMediaAt(mId, trackId, frame, false);
        const seq = mc.query.activeSequence(mc.store.getProject());
        // Find the newest video clip at or near frame 90
        for (const t of seq.tracks) {
          if (t.id !== trackId) continue;
          for (const c of t.clips) {
            if (c.start === frame) return c.id;
          }
        }
        return "";
      },
      { mId: mediaId, trackId: v1Id, frame: CLIP_B_START },
    );

    // Low zoom so everything fits within the ~436px e2e lane.
    await setPxPerFrame(page, 4);
  });

  test("snap ON: clip end snaps flush to neighbour start", async ({ page }) => {
    await setSnapping(page, true);

    // Verify initial state.
    const infoBefore = (await clipInfo(page, clipAId))!;
    expect(infoBefore.start).toBe(0);
    expect(infoBefore.duration).toBe(CLIP_A_DURATION);

    const infoBBefore = (await clipInfo(page, clipBId))!;
    expect(infoBBefore.start).toBe(CLIP_B_START);

    // Drag clip A right by 44 frames → raw end = 90, exactly at clipB.start.
    // The snap threshold is 2 frames; d=0 ≤ 2 → snaps.
    await dragClipByFrames(page, clipAId, 44);

    const infoA = (await clipInfo(page, clipAId))!;
    // Snapped end should be at clipB.start (90) → start = 90 - 46 = 44.
    const expectedStart = CLIP_B_START - CLIP_A_DURATION; // 44
    expect(infoA.start).toBeGreaterThanOrEqual(expectedStart - 1);
    expect(infoA.start).toBeLessThanOrEqual(expectedStart + 1);
    // End (start + duration) should be flush with clipB.start.
    const endA = infoA.start + infoA.duration;
    expect(endA).toBeGreaterThanOrEqual(CLIP_B_START - 1);
    expect(endA).toBeLessThanOrEqual(CLIP_B_START + 1);

    // Clip B must not have moved.
    const infoBAfter = (await clipInfo(page, clipBId))!;
    expect(infoBAfter.start).toBe(CLIP_B_START);
  });

  test("snap OFF: drag leaves a visible gap before neighbour", async ({ page }) => {
    await setSnapping(page, false);

    // Drag by 43 frames → raw end = 46+43 = 89, which is 1 frame short of 90.
    // With snapping off there is no correction, so end stays strictly < 90.
    await dragClipByFrames(page, clipAId, 43);

    const infoA = (await clipInfo(page, clipAId))!;
    const endA = infoA.start + infoA.duration;

    // Raw end should be around 89 (±2 pointer tolerance), strictly < clipB.start.
    expect(endA).toBeLessThan(CLIP_B_START);

    // Clip B must not have moved.
    const infoBAfter = (await clipInfo(page, clipBId))!;
    expect(infoBAfter.start).toBe(CLIP_B_START);
  });
});
