// ─────────────────────────────────────────────────────────────
// engine/dsp/adaptive-noise-reduction.test — Audition-style Adaptive NR
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { whiteNoise } from "../generate/noise";
import { hissReduction } from "./hiss-reduction";
import { adaptiveNoiseReduction } from "./adaptive-noise-reduction";

const SR = 44100;

const noise = (seconds: number, amp: number, seed = 1) => whiteNoise(seconds, { sampleRate: SR, amplitude: amp, seed }).channels[0];

/** RMS over a sample range [from, to). */
function rms(ch: Float32Array, from = 0, to = ch.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Quiet noise (amp 0.01) for `half` seconds, then loud noise (amp 0.04). */
function quietThenLoud(half = 2): AudioData {
  const q = noise(half, 0.01, 1);
  const l = noise(half, 0.04, 2);
  const buf = new Float32Array(q.length + l.length);
  buf.set(q, 0);
  buf.set(l, q.length);
  return { sampleRate: SR, channels: [buf] };
}

describe("adaptiveNoiseReduction", () => {
  it("reduces stationary broadband noise", () => {
    const s: AudioData = { sampleRate: SR, channels: [noise(0.8, 0.03, 1)] };
    const out = adaptiveNoiseReduction(s, {});
    expect(rms(out.channels[0])).toBeLessThan(rms(s.channels[0]) * 0.7);
  });

  it("tracks non-stationary noise: reduces both a quiet and a loud half", () => {
    const s = quietThenLoud(2);
    const mid = frameCount(s) / 2;
    const end = frameCount(s);
    // adaptMs 500 (vs the 1000 default) lets the floor settle to the loud half
    // before the last-0.5s measurement window; the default would pass too, with a
    // smaller margin.
    const out = adaptiveNoiseReduction(s, { adaptMs: 500 });
    // Settled tail of each half (last 0.5 s) so the floor has adapted.
    const q0 = rms(s.channels[0], mid - SR / 2, mid);
    const q1 = rms(out.channels[0], mid - SR / 2, mid);
    const l0 = rms(s.channels[0], end - SR / 2, end);
    const l1 = rms(out.channels[0], end - SR / 2, end);
    expect(q1).toBeLessThan(q0 * 0.7); // quiet half reduced
    expect(l1).toBeLessThan(l0 * 0.7); // loud half reduced too (floor tracked up)
  });

  it("beats the static-floor Hiss Reduction on the loud half of non-stationary noise", () => {
    const s = quietThenLoud(2);
    const end = frameCount(s);
    const adaptive = adaptiveNoiseReduction(s, { adaptMs: 500 });
    const hiss = hissReduction(s, {});
    const adaptiveLoud = rms(adaptive.channels[0], end - SR / 2, end);
    const hissLoud = rms(hiss.channels[0], end - SR / 2, end);
    // The static global floor under-reduces the loud half; the adaptive floor tracks it.
    expect(adaptiveLoud).toBeLessThan(hissLoud * 0.8);
  });

  it("is a transparent round-trip at reduceByDb 0", () => {
    const s: AudioData = { sampleRate: SR, channels: [noise(0.5, 0.2, 3)] };
    const out = adaptiveNoiseReduction(s, { reduceByDb: 0 });
    // WOLA reconstruction is near-exact (Float32 output ~1e-7); 1e-4 still catches
    // a real reconstruction regression (window/norm/pad error) without flaking.
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBeLessThan(1e-4);
  });

  it("preserves frame count and is deterministic", () => {
    const s: AudioData = { sampleRate: SR, channels: [noise(0.5, 0.03, 1)] };
    const a = adaptiveNoiseReduction(s, {});
    const b = adaptiveNoiseReduction(s, {});
    expect(frameCount(a)).toBe(frameCount(s));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const s: AudioData = { sampleRate: SR, channels: [noise(0.5, 0.03, 1)] };
    const snap = Float32Array.from(s.channels[0]);
    adaptiveNoiseReduction(s, {});
    expect(maxAbsDiff(s.channels[0], snap)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = adaptiveNoiseReduction(empty, {});
    expect(frameCount(out)).toBe(0);
  });
});
