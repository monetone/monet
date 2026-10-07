// ─────────────────────────────────────────────────────────────
// engine/ops/render-range.test — renderProjectRange + markersInRange
// ─────────────────────────────────────────────────────────────
// The data behind "Export selected range": render a time window of the project
// and re-base any markers inside it.

import { describe, expect, it } from "vitest";
import { durationSeconds } from "../audio/types";
import { sliceFrames } from "../audio/buffer";
import { sine } from "../generate/tone";
import { markersInRange } from "../io/markers";
import { newMarker } from "../model/factory";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import type { Project } from "../model/types";
import { addClip } from "./clip";
import { renderProject, renderProjectRange } from "./render";

const SR = 48000;

/** One track holding a single 4 s tone from t=0. */
function project(): Project {
  resetIds();
  let p = emptyProject("RR", 0, SR);
  const track = newTrack(0, { name: "T" });
  p = { ...p, tracks: [track] };
  return addClip(p, track.id, newClip(sine(440, 4, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: track.id, start: 0 }));
}

describe("renderProjectRange", () => {
  it("renders exactly the requested window", () => {
    const r = renderProjectRange(project(), 1, 3);
    expect(durationSeconds(r)).toBeCloseTo(2, 6);
  });

  it("matches the corresponding slice of the full render", () => {
    const p = project();
    const range = renderProjectRange(p, 1, 3);
    const sliced = sliceFrames(renderProject(p), SR * 1, SR * 3);
    expect(range.channels[0].length).toBe(sliced.channels[0].length);
    for (let i = 0; i < range.channels[0].length; i += 257) {
      expect(range.channels[0][i]).toBeCloseTo(sliced.channels[0][i], 6);
    }
  });

  it("clamps a negative start and an inverted span", () => {
    expect(durationSeconds(renderProjectRange(project(), -1, 2))).toBeCloseTo(2, 6); // start clamped to 0
    expect(durationSeconds(renderProjectRange(project(), 3, 1))).toBe(0); // end < start → empty
  });
});

describe("markersInRange", () => {
  it("keeps markers inside [start, end) and re-bases them to the origin", () => {
    const markers = [
      newMarker({ time: 0.5, name: "A" }),
      newMarker({ time: 1.5, name: "B" }),
      newMarker({ time: 2.5, name: "C" }),
      newMarker({ time: 3.5, name: "D" }),
    ];
    const out = markersInRange(markers, 1, 3);
    expect(out).toEqual([
      { time: 0.5, name: "B" }, // 1.5 − 1
      { time: 1.5, name: "C" }, // 2.5 − 1
    ]);
  });

  it("is half-open: includes the start edge, excludes the end edge", () => {
    const markers = [newMarker({ time: 1, name: "start" }), newMarker({ time: 3, name: "end" })];
    const out = markersInRange(markers, 1, 3);
    expect(out).toEqual([{ time: 0, name: "start" }]);
  });
});
