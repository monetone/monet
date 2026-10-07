// ─────────────────────────────────────────────────────────────
// engine/ops/split-markers.test — split clips at marker positions
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { clipEnd } from "../model/query";
import { sine } from "../generate/tone";
import { emptyProject, newClip, newMarker, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import type { Marker, Project } from "../model/types";
import { addClip } from "./clip";
import { splitClipsAtMarkers } from "./split-markers";

const SR = 48000;

/** One track holding a single 4-second clip from t=0, plus the given markers. */
function project(markers: Marker[]): { project: Project; trackId: string } {
  resetIds();
  let p = emptyProject("SM", 0, SR);
  const track = newTrack(0, { name: "T" });
  p = { ...p, tracks: [track], markers };
  const clip = newClip(sine(440, 4, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: track.id, start: 0 });
  p = addClip(p, track.id, clip);
  return { project: p, trackId: track.id };
}

const clips = (p: Project) => p.tracks[0].clips;

describe("splitClipsAtMarkers", () => {
  it("splits a clip into N+1 pieces at N cue markers inside it", () => {
    const { project: p } = project([newMarker({ time: 1 }), newMarker({ time: 2 }), newMarker({ time: 3 })]);
    const out = splitClipsAtMarkers(p);
    const cs = clips(out).slice().sort((a, b) => a.start - b.start);
    expect(cs).toHaveLength(4);
    expect(cs.map((c) => Number(c.start.toFixed(3)))).toEqual([0, 1, 2, 3]);
    expect(Number(clipEnd(cs[3]).toFixed(3))).toBe(4);
  });

  it("cuts a region marker at both its start and end", () => {
    const { project: p } = project([newMarker({ time: 1, end: 2.5, name: "R" })]);
    const out = splitClipsAtMarkers(p);
    const cs = clips(out).slice().sort((a, b) => a.start - b.start);
    expect(cs.map((c) => Number(c.start.toFixed(3)))).toEqual([0, 1, 2.5]); // 3 clips
  });

  it("ignores markers on a clip edge or outside any clip, and is immutable", () => {
    const { project: p } = project([newMarker({ time: 0 }), newMarker({ time: 4 }), newMarker({ time: 6 })]);
    const out = splitClipsAtMarkers(p);
    expect(out).toBe(p); // nothing straddled → same reference
    expect(clips(out)).toHaveLength(1);
  });

  it("is a no-op when there are no markers", () => {
    const { project: p } = project([]);
    expect(splitClipsAtMarkers(p)).toBe(p);
  });

  it("only splits the requested tracks", () => {
    resetIds();
    let p = emptyProject("SM", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    p = { ...p, tracks: [a, b], markers: [newMarker({ time: 2 })] };
    p = addClip(p, a.id, newClip(sine(440, 4, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: a.id, start: 0 }));
    p = addClip(p, b.id, newClip(sine(330, 4, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: b.id, start: 0 }));
    const out = splitClipsAtMarkers(p, [a.id]);
    expect(out.tracks.find((t) => t.id === a.id)!.clips).toHaveLength(2); // split
    expect(out.tracks.find((t) => t.id === b.id)!.clips).toHaveLength(1); // untouched
  });

  it("preserves total audio (splits are seamless)", () => {
    const { project: p } = project([newMarker({ time: 1.5 }), newMarker({ time: 3 })]);
    const out = splitClipsAtMarkers(p);
    const cs = clips(out).slice().sort((a, b) => a.start - b.start);
    // contiguous coverage from 0 to 4 with no gaps/overlaps
    let cursor = 0;
    for (const c of cs) {
      expect(c.start).toBeCloseTo(cursor, 5);
      cursor = clipEnd(c);
    }
    expect(cursor).toBeCloseTo(4, 5);
  });
});
