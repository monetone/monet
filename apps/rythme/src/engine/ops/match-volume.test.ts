// ─────────────────────────────────────────────────────────────
// engine/ops/match-volume.test — Match Clip Volume
// ─────────────────────────────────────────────────────────────
// Clips of different amplitude must render at the same level after matching,
// achieved purely by setting each clip's gain trim (non-destructive).

import { describe, expect, it } from "vitest";
import { gainToDb } from "../audio/db";
import { sine } from "../generate/tone";
import { generateSilence } from "../generate/silence";
import { peakAmplitude, rmsAmplitude } from "../dsp/normalize";
import { measureLoudness } from "../analysis/loudness";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import type { Project } from "../model/types";
import { addClip } from "./clip";
import { renderClip } from "./render";
import { matchClipVolume } from "./match-volume";

const SR = 44100;

/** A track with clips built from the given tone amplitudes (each 0.5 s). */
function project(amps: number[]): { project: Project; ids: string[] } {
  resetIds();
  let p = emptyProject("MV", 0, SR);
  const track = newTrack(0, { name: "T" });
  p = { ...p, tracks: [track] };
  const ids: string[] = [];
  amps.forEach((amp, i) => {
    const clip = newClip(sine(300 + i * 30, 0.5, { sampleRate: SR, amplitude: amp, channels: 2 }), { trackId: track.id, start: i });
    p = addClip(p, track.id, clip);
    ids.push(clip.id);
  });
  return { project: p, ids };
}

const clipsOf = (p: Project) => p.tracks[0].clips;

describe("matchClipVolume", () => {
  it("equalises peak level across clips (quiet clip comes up to the loudest)", () => {
    const { project: p, ids } = project([0.5, 0.125]); // 12 dB apart
    const out = matchClipVolume(p, ids, { mode: "peak" });
    const clips = clipsOf(out);
    expect(clips[0].gainDb).toBeCloseTo(0, 1); // loudest unchanged
    expect(clips[1].gainDb).toBeCloseTo(12.04, 1); // quiet one boosted ~12 dB
    const p0 = peakAmplitude(renderClip(clips[0]));
    const p1 = peakAmplitude(renderClip(clips[1]));
    expect(gainToDb(p1)).toBeCloseTo(gainToDb(p0), 1); // render at the same peak
  });

  it("equalises total RMS in rms mode", () => {
    const { project: p, ids } = project([0.6, 0.2, 0.4]);
    const out = matchClipVolume(p, ids, { mode: "rms" });
    const rms = clipsOf(out).map((c) => gainToDb(rmsAmplitude(renderClip(c))));
    expect(Math.max(...rms) - Math.min(...rms)).toBeLessThan(0.5); // all within 0.5 dB
  });

  it("equalises integrated loudness in loudness mode", () => {
    const { project: p, ids } = project([0.7, 0.15]);
    const out = matchClipVolume(p, ids, { mode: "loudness" });
    const lufs = clipsOf(out).map((c) => measureLoudness(renderClip(c)).integrated);
    expect(Math.abs(lufs[0] - lufs[1])).toBeLessThan(1); // within 1 LU
  });

  it("matches to an explicit target when given", () => {
    const { project: p, ids } = project([0.5, 0.25]);
    const out = matchClipVolume(p, ids, { mode: "peak", targetDb: -12 });
    for (const c of clipsOf(out)) {
      expect(gainToDb(peakAmplitude(renderClip(c)))).toBeCloseTo(-12, 1);
    }
  });

  it("skips silent or unmeasurable clips and is immutable", () => {
    resetIds();
    let p = emptyProject("MV", 0, SR);
    const track = newTrack(0, { name: "T" });
    p = { ...p, tracks: [track] };
    const loud = newClip(sine(440, 0.5, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: track.id, start: 0 });
    const silent = newClip(generateSilence(0.5, 2, SR), { trackId: track.id, start: 1 });
    p = addClip(addClip(p, track.id, loud), track.id, silent);
    const before = p.tracks[0].clips[1];
    const out = matchClipVolume(p, [loud.id, silent.id], { mode: "peak", targetDb: -6 });
    expect(out.tracks[0].clips[1]).toBe(before); // silent clip untouched (same ref)
    expect(out.tracks[0].clips[0].gainDb).toBeCloseTo(-6 - gainToDb(0.5), 1);
    expect(out).not.toBe(p);
  });

  it("is a no-op for an empty set or all-silent clips", () => {
    const { project: p, ids } = project([0.5, 0.25]);
    expect(matchClipVolume(p, [], {})).toBe(p);
    expect(matchClipVolume(p, ["ghost"], {})).toBe(p);
    // a single clip matched to its own loudest level → its gain is already 0 → unchanged ref
    expect(matchClipVolume(p, [ids[0]], { mode: "peak" })).toBe(p);
  });
});
