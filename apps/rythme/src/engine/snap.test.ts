// ─────────────────────────────────────────────────────────────
// snap.test — Snapping (Edit ▸ Snapping): clip drags snap to edges
// ─────────────────────────────────────────────────────────────
// snapTime is the shared @monet-ui/monet-timeline helper, re-exported on the
// engine barrel; these tests pin the behavior Rythme relies on for clip drags.

import { describe, expect, it } from "vitest";
import { createAudioData } from "./audio/buffer";
import { emptyProject, newClip } from "./model/factory";
import type { Project } from "./model/types";
import { snapTime } from "./model/query";

const SR = 48000;

/** One track with a clip spanning 2 → 3 s. (Marker/playhead snap candidates are
 *  passed via the `extra` argument by the caller, not read off the project.) */
function project(): Project {
  const p = emptyProject("T", 1, SR);
  const [t0] = p.tracks;
  return { ...p, tracks: [{ ...t0, clips: [newClip(createAudioData(2, SR, SR), { trackId: t0.id, start: 2, name: "A" })] }] };
}

describe("snapTime", () => {
  const p = project();
  const clipId = p.tracks[0].clips[0].id;

  it("snaps to a clip's start / end edge within the threshold", () => {
    expect(snapTime(p, 2.05, 0.1)).toBe(2); // near the start
    expect(snapTime(p, 3.04, 0.1)).toBe(3); // near the end (start + 1 s)
  });

  it("leaves the time unchanged when no edge is within the threshold", () => {
    expect(snapTime(p, 2.05, 0.01)).toBe(2.05); // 0.05 s away > 0.01 tolerance
  });

  it("snaps to the timeline origin (0)", () => {
    expect(snapTime(p, 0.05, 0.1)).toBe(0);
  });

  it("snaps to an extra candidate such as a marker time", () => {
    expect(snapTime(p, 5.05, 0.1, undefined, [5])).toBe(5);
  });

  it("excludes the dragged clip's own edges (so it doesn't snap to itself)", () => {
    expect(snapTime(p, 2.05, 0.1, clipId)).toBe(2.05); // the only edges belong to the excluded clip
  });
});
