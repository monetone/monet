// ─────────────────────────────────────────────────────────────
// engine/ops/crossfade.test — multitrack clip crossfades
// ─────────────────────────────────────────────────────────────
// Two overlapping clips are crossfaded; the rendered overlap must have no level
// jump — equal-power keeps POWER constant for uncorrelated material, linear
// keeps AMPLITUDE constant for correlated (identical) material.

import { describe, expect, it } from "vitest";
import { sine } from "../generate/tone";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import type { Project } from "../model/types";
import { addClip } from "./clip";
import { renderTrack } from "./render";
import { autoCrossfadeTrack, crossfadeClips } from "./crossfade";

const SR = 48000;

/** RMS of channel 0 over [t0, t1) seconds of a rendered buffer. */
function rmsAt(d: { channels: Float32Array[] }, t0: number, t1: number): number {
  const ch = d.channels[0];
  const a = Math.round(t0 * SR);
  const b = Math.round(t1 * SR);
  let sum = 0;
  for (let i = a; i < b; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** One track, two clips: A at 0 (1.0 s) and B at 0.8 (1.0 s) → 0.2 s overlap. */
function overlapProject(freqA: number, freqB: number): { project: Project; trackId: string; aId: string; bId: string } {
  resetIds();
  let project = emptyProject("XF", 0, SR);
  const track = newTrack(0, { name: "T" });
  project = { ...project, tracks: [track] };
  const a = newClip(sine(freqA, 1.0, { sampleRate: SR, amplitude: 0.6, channels: 2 }), { trackId: track.id, start: 0 });
  const b = newClip(sine(freqB, 1.0, { sampleRate: SR, amplitude: 0.6, channels: 2 }), { trackId: track.id, start: 0.8 });
  project = addClip(addClip(project, track.id, a), track.id, b);
  return { project, trackId: track.id, aId: a.id, bId: b.id };
}

describe("crossfadeClips", () => {
  it("sets the earlier fade-out and later fade-in to the overlap length", () => {
    const { project, trackId, aId, bId } = overlapProject(440, 557);
    const out = crossfadeClips(project, aId, bId, { shape: "equalPower" });
    const clips = out.tracks.find((t) => t.id === trackId)!.clips;
    const a = clips.find((c) => c.id === aId)!;
    const b = clips.find((c) => c.id === bId)!;
    expect(a.fadeOut).toBeCloseTo(0.2, 5);
    expect(a.fadeOutShape).toBe("equalPower");
    expect(b.fadeIn).toBeCloseTo(0.2, 5);
    expect(b.fadeInShape).toBe("equalPower");
  });

  it("equal-power keeps power ~constant across the seam (uncorrelated tones)", () => {
    const { project, trackId, aId, bId } = overlapProject(440, 557);
    const ref = rmsAt(renderTrack(project.tracks[0], SR, 2), 0.3, 0.7); // a single clip, no overlap
    const raw = rmsAt(renderTrack(project.tracks[0], SR, 2), 0.88, 0.92); // overlap, no crossfade → ~√2·ref
    const out = crossfadeClips(project, aId, bId, { shape: "equalPower" });
    const xf = rmsAt(renderTrack(out.tracks.find((t) => t.id === trackId)!, SR, 2), 0.88, 0.92);
    expect(raw).toBeGreaterThan(ref * 1.3); // the raw sum bumps up ~3 dB
    expect(xf).toBeGreaterThan(ref * 0.85); // crossfade holds the level …
    expect(xf).toBeLessThan(ref * 1.15); // … with no dip or bump
  });

  it("linear keeps amplitude ~constant across the seam (identical material)", () => {
    const { project, trackId, aId, bId } = overlapProject(440, 440); // same tone & phase
    const ref = rmsAt(renderTrack(project.tracks[0], SR, 2), 0.3, 0.7);
    const out = crossfadeClips(project, aId, bId, { shape: "linear" });
    const xf = rmsAt(renderTrack(out.tracks.find((t) => t.id === trackId)!, SR, 2), 0.85, 0.95);
    expect(xf).toBeGreaterThan(ref * 0.9);
    expect(xf).toBeLessThan(ref * 1.1);
  });

  it("is a no-op for non-overlapping or cross-track clips, and is immutable", () => {
    const { project, trackId, aId, bId } = overlapProject(440, 557);
    // move B so it no longer overlaps
    const moved = {
      ...project,
      tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === bId ? { ...c, start: 2.0 } : c)) })),
    };
    expect(crossfadeClips(moved, aId, bId)).toBe(moved);
    expect(crossfadeClips(project, aId, aId)).toBe(project); // same clip
    // original untouched
    const before = project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === aId)!;
    const out = crossfadeClips(project, aId, bId);
    expect(out).not.toBe(project);
    expect(before.fadeOut).toBe(0);
  });

  it("orders the pair by start time regardless of argument order", () => {
    const { project, aId, bId } = overlapProject(440, 557);
    const out = crossfadeClips(project, bId, aId); // pass later first
    const clips = out.tracks[0].clips;
    expect(clips.find((c) => c.id === aId)!.fadeOut).toBeCloseTo(0.2, 5); // earlier still fades out
    expect(clips.find((c) => c.id === bId)!.fadeIn).toBeCloseTo(0.2, 5);
  });
});

describe("autoCrossfadeTrack", () => {
  it("crossfades every adjacent overlapping pair on the track", () => {
    resetIds();
    let project = emptyProject("XF", 0, SR);
    const track = newTrack(0, { name: "T" });
    project = { ...project, tracks: [track] };
    // three clips, each overlapping the next by 0.2 s
    const c0 = newClip(sine(440, 1.0, { sampleRate: SR, amplitude: 0.6, channels: 2 }), { trackId: track.id, start: 0 });
    const c1 = newClip(sine(557, 1.0, { sampleRate: SR, amplitude: 0.6, channels: 2 }), { trackId: track.id, start: 0.8 });
    const c2 = newClip(sine(659, 1.0, { sampleRate: SR, amplitude: 0.6, channels: 2 }), { trackId: track.id, start: 1.6 });
    project = addClip(addClip(addClip(project, track.id, c0), track.id, c1), track.id, c2);

    const out = autoCrossfadeTrack(project, track.id);
    const clips = out.tracks[0].clips;
    expect(clips.find((c) => c.id === c0.id)!.fadeOut).toBeCloseTo(0.2, 5);
    expect(clips.find((c) => c.id === c1.id)!.fadeIn).toBeCloseTo(0.2, 5);
    expect(clips.find((c) => c.id === c1.id)!.fadeOut).toBeCloseTo(0.2, 5); // middle clip fades both ways
    expect(clips.find((c) => c.id === c2.id)!.fadeIn).toBeCloseTo(0.2, 5);
  });

  it("returns the project unchanged for a missing track", () => {
    const { project } = overlapProject(440, 557);
    expect(autoCrossfadeTrack(project, "nope")).toBe(project);
  });
});
