// ─────────────────────────────────────────────────────────────
// engine/ops/merge.test — merge (join) clips
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { durationSeconds } from "../audio/types";
import { sliceFrames } from "../audio/buffer";
import { sine } from "../generate/tone";
import { detectPitch } from "../analysis/pitch";
import { rmsAmplitude } from "../dsp/normalize";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import type { Project } from "../model/types";
import { addClip } from "./clip";
import { renderClip } from "./render";
import { mergeClips } from "./merge";

const SR = 44100;

/** A project with the given (start, freq) clips — each a 1 s tone — on one track. */
function project(specs: { start: number; freq: number; amp?: number }[]): { project: Project; trackId: string; ids: string[] } {
  resetIds();
  let p = emptyProject("MG", 0, SR);
  const track = newTrack(0, { name: "T" });
  p = { ...p, tracks: [track] };
  const ids: string[] = [];
  for (const s of specs) {
    const clip = newClip(sine(s.freq, 1, { sampleRate: SR, amplitude: s.amp ?? 0.5, channels: 2 }), { trackId: track.id, start: s.start });
    p = addClip(p, track.id, clip);
    ids.push(clip.id);
  }
  return { project: p, trackId: track.id, ids };
}

const rmsAt = (d: { channels: Float32Array[]; sampleRate: number }, t0: number, t1: number) =>
  rmsAmplitude(sliceFrames(d, Math.round(t0 * SR), Math.round(t1 * SR)));

describe("mergeClips", () => {
  it("joins two adjacent clips into one whose audio is their concatenation", () => {
    const { project: p, ids } = project([{ start: 0, freq: 440 }, { start: 1, freq: 330 }]); // A4 then E4
    const out = mergeClips(p, ids);
    const clips = out.tracks[0].clips;
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBe(0);
    expect(durationSeconds(clips[0].buffer)).toBeCloseTo(2, 1);
    const r = renderClip(clips[0]);
    expect(detectPitch(sliceFrames(r, 0, Math.round(0.9 * SR))).note).toBe("A"); // first second = 440
    expect(detectPitch(sliceFrames(r, Math.round(1.1 * SR), Math.round(2 * SR))).note).toBe("E"); // second = 330
  });

  it("sums overlapping clips in the overlap region", () => {
    const { project: p, ids } = project([{ start: 0, freq: 440, amp: 0.4 }, { start: 0.5, freq: 440, amp: 0.4 }]);
    const out = mergeClips(p, ids);
    const r = renderClip(out.tracks[0].clips[0]);
    expect(durationSeconds(r)).toBeCloseTo(1.5, 1);
    const solo = rmsAt(r, 0.1, 0.4); // only clip A
    const both = rmsAt(r, 0.6, 0.9); // A + B (in phase at 440 Hz) → louder
    expect(both).toBeGreaterThan(solo * 1.5);
  });

  it("places the merged clip at the earliest start and keeps other clips", () => {
    const { project: p, ids } = project([{ start: 2, freq: 440 }, { start: 4, freq: 330 }, { start: 8, freq: 550 }]);
    const out = mergeClips(p, [ids[0], ids[1]]); // merge the first two, leave the third
    const clips = out.tracks[0].clips.slice().sort((a, b) => a.start - b.start);
    expect(clips).toHaveLength(2);
    expect(clips[0].start).toBe(2);
    expect(durationSeconds(clips[0].buffer)).toBeCloseTo(3, 1); // 2 … 5
    expect(clips[1].start).toBe(8); // untouched
  });

  it("is a no-op for a single clip, cross-track clips, or an empty set", () => {
    const { project: p, ids } = project([{ start: 0, freq: 440 }, { start: 1, freq: 330 }]);
    expect(mergeClips(p, [])).toBe(p);
    expect(mergeClips(p, [ids[0]])).toBe(p); // one clip
    // cross-track
    resetIds();
    let q = emptyProject("MG", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    q = { ...q, tracks: [a, b] };
    const ca = newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: a.id, start: 0 });
    const cb = newClip(sine(330, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: b.id, start: 0 });
    q = addClip(addClip(q, a.id, ca), b.id, cb);
    expect(mergeClips(q, [ca.id, cb.id])).toBe(q);
  });

  it("does not mutate the input project", () => {
    const { project: p, ids } = project([{ start: 0, freq: 440 }, { start: 1, freq: 330 }]);
    const out = mergeClips(p, ids);
    expect(out).not.toBe(p);
    expect(p.tracks[0].clips).toHaveLength(2); // original still has both clips
  });
});
