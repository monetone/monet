// ─────────────────────────────────────────────────────────────
// ops/bounce.test — Bounce to New Track (Adobe Audition parity)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { emptyProject, newClip } from "../model/factory";
import type { Project } from "../model/types";
import { renderProject } from "./render";
import { appendBouncedTrack, bounceProjectToNewTrack, bounceTrackToNewTrack } from "./bounce";

const peak = (ch: Float32Array) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

const SR = 48000;

function tone(freq: number, secs = 0.1, amp = 0.5) {
  const n = Math.round(SR * secs);
  const d = createAudioData(2, n, SR);
  for (let i = 0; i < n; i++) {
    const v = amp * Math.sin((2 * Math.PI * freq * i) / SR);
    d.channels[0][i] = v;
    d.channels[1][i] = v;
  }
  return d;
}

/** Two tracks, each one sine clip at t=0. */
function project(): Project {
  const p = emptyProject("T", 2, SR);
  const [t0, t1] = p.tracks;
  return {
    ...p,
    tracks: [
      { ...t0, clips: [newClip(tone(220), { trackId: t0.id, start: 0, name: "a" })] },
      { ...t1, clips: [newClip(tone(440), { trackId: t1.id, start: 0, name: "b" })] },
    ],
  };
}

function expectSamplesClose(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += Math.max(1, Math.floor(a.length / 64))) {
    expect(a[i]).toBeCloseTo(b[i], 6);
  }
}

describe("appendBouncedTrack", () => {
  it("adds one track holding the audio as a single clip at t=0, immutably", () => {
    const p = project();
    const audio = tone(330);
    const out = appendBouncedTrack(p, audio, "Bounced");
    expect(out).not.toBe(p);
    expect(out.tracks.length).toBe(3);
    const nt = out.tracks[2];
    expect(nt.name).toBe("Bounced");
    expect(nt.clips).toHaveLength(1);
    expect(nt.clips[0].start).toBe(0);
    expect(nt.clips[0].buffer).toBe(audio);
    expect(p.tracks).toHaveLength(2); // source untouched
  });

  it("gives the new track a fresh id distinct from the sources", () => {
    const p = project();
    const out = appendBouncedTrack(p, tone(330), "Bounced");
    const ids = out.tracks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("bounceTrackToNewTrack", () => {
  it("bakes the source track through its full mixer strip onto the new track", () => {
    const p = project();
    const src = p.tracks[0];
    const out = bounceTrackToNewTrack(p, src.id);
    expect(out.tracks.length).toBe(3);
    expect(out.tracks[2].name).toBe("Track 1 (Bounced)");
    const strip = renderProject({ ...p, tracks: [src] }, { applyMaster: false });
    expectSamplesClose(out.tracks[2].clips[0].buffer.channels[0], strip.channels[0]);
    // independent oracle: with gain 0 / pan 0 the bounce keeps the source amplitude (0.5)
    expect(peak(out.tracks[2].clips[0].buffer.channels[0])).toBeCloseTo(0.5, 2);
  });

  it("applies the track's gain to the bounce (−6 dB ≈ half the peak)", () => {
    const base = project();
    const src = { ...base.tracks[0], gainDb: -6 };
    const p = { ...base, tracks: [src, base.tracks[1]] };
    const bounced = peak(bounceTrackToNewTrack(p, src.id).tracks.at(-1)!.clips[0].buffer.channels[0]);
    const dry = peak(renderProject({ ...p, tracks: [{ ...src, gainDb: 0 }] }, { applyMaster: false }).channels[0]);
    expect(bounced / dry).toBeCloseTo(Math.pow(10, -6 / 20), 2); // ~0.501
  });

  it("applies the track's pan (hard-left leaves the right channel ~silent)", () => {
    const base = project();
    const src = { ...base.tracks[0], pan: -1 };
    const p = { ...base, tracks: [src, base.tracks[1]] };
    const right = bounceTrackToNewTrack(p, src.id).tracks.at(-1)!.clips[0].buffer.channels[1];
    expect(peak(right)).toBeLessThan(0.05);
  });

  it("is a no-op (same ref) for an unknown track id", () => {
    const p = project();
    expect(bounceTrackToNewTrack(p, "does-not-exist")).toBe(p);
  });
});

describe("bounceProjectToNewTrack", () => {
  it("bakes the whole session mix onto the new track", () => {
    const p = project();
    const out = bounceProjectToNewTrack(p);
    expect(out.tracks.length).toBe(3);
    expectSamplesClose(out.tracks[2].clips[0].buffer.channels[0], renderProject(p).channels[0]);
  });

  it("is a no-op (same ref) on an empty session", () => {
    const empty = emptyProject("E", 0, SR);
    expect(bounceProjectToNewTrack(empty)).toBe(empty);
  });
});
