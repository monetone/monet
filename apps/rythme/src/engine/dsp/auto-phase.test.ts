// ─────────────────────────────────────────────────────────────
// engine/dsp/auto-phase.test — Audition-style Automatic Phase Correction
// ─────────────────────────────────────────────────────────────
// Verifies inter-channel alignment: a known delay between the channels is
// detected and removed (their cross-correlation peak moves to lag 0), an
// out-of-polarity pair is flipped back (mono sum recovers), the manual Global
// Time Shift applies an exact shift, and an already-aligned pair is untouched.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { whiteNoise } from "../generate/noise";
import { autoPhaseCorrect } from "./auto-phase";

const SR = 44100;

const noise = (seed = 9, seconds = 0.2) => whiteNoise(seconds, { sampleRate: SR, amplitude: 0.5, seed, channels: 1 }).channels[0];

/** Delay a mono channel by `d` samples (positive = later), zero-filled. */
function delayBy(ch: Float32Array, d: number): Float32Array {
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    const j = i - d;
    if (j >= 0 && j < ch.length) out[i] = ch[j];
  }
  return out;
}

function stereo(l: Float32Array, r: Float32Array): AudioData {
  return { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
}

/** Best |lag| (within ±max) aligning b to a — used to confirm post-correction alignment. */
function bestLag(a: Float32Array, b: Float32Array, max = 80): number {
  const n = a.length;
  const s = 200;
  const e = n - 200;
  let lagAt = 0;
  let best = -Infinity;
  for (let lag = -max; lag <= max; lag++) {
    let dot = 0;
    for (let i = s; i < e; i++) {
      const j = i + lag;
      dot += a[i] * (j >= 0 && j < n ? b[j] : 0);
    }
    if (Math.abs(dot) > best) {
      best = Math.abs(dot);
      lagAt = lag;
    }
  }
  return lagAt;
}

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, ch.length));
}

function monoSumRms(d: AudioData): number {
  const [a, b] = d.channels;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] + b[i];
    s += v * v;
  }
  return Math.sqrt(s / Math.max(1, a.length));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("autoPhaseCorrect — auto align", () => {
  it("detects and removes a positive inter-channel delay", () => {
    const base = noise();
    for (const D of [11, 23, 50]) {
      const d = stereo(base, delayBy(base, D));
      expect(bestLag(d.channels[0], d.channels[1])).toBe(D); // mis-aligned going in
      const out = autoPhaseCorrect(d, { maxShiftMs: 5 });
      expect(Math.abs(bestLag(out.channels[0], out.channels[1]))).toBeLessThanOrEqual(1);
    }
  });

  it("leaves an already-aligned pair essentially untouched", () => {
    const base = noise();
    const out = autoPhaseCorrect(stereo(base, base), { maxShiftMs: 5 });
    expect(maxAbsDiff(out.channels[0], base)).toBe(0);
    expect(maxAbsDiff(out.channels[1], base)).toBeLessThan(1e-6);
  });

  it("flips an out-of-polarity channel so the mono sum recovers", () => {
    const base = noise();
    const inv = base.map((v) => -v) as Float32Array;
    const d = stereo(base, inv);
    expect(monoSumRms(d)).toBeLessThan(1e-6); // L + (−L) cancels to silence
    const out = autoPhaseCorrect(d, { maxShiftMs: 2, correctPolarity: true });
    expect(monoSumRms(out)).toBeGreaterThan(rms(base)); // now ~2·L → strong mono sum
  });

  it("respects correctPolarity=false (leaves the inversion)", () => {
    const base = noise();
    const inv = base.map((v) => -v) as Float32Array;
    const out = autoPhaseCorrect(stereo(base, inv), { maxShiftMs: 2, correctPolarity: false });
    expect(monoSumRms(out)).toBeLessThan(1e-6);
  });

  it("maxShiftMs=0 corrects polarity but does not time-align", () => {
    const base = noise();
    const out = autoPhaseCorrect(stereo(base, delayBy(base, 30)), { maxShiftMs: 0 });
    expect(bestLag(out.channels[0], out.channels[1])).toBe(30); // delay left intact
  });
});

describe("autoPhaseCorrect — global time shift", () => {
  it("applies an exact manual shift to the right channel", () => {
    const base = noise();
    const shiftSamples = 17;
    const out = autoPhaseCorrect(stereo(base, base), { mode: "global", rightShiftMs: (shiftSamples / SR) * 1000 });
    for (let i = 200; i < base.length; i++) expect(out.channels[1][i]).toBeCloseTo(base[i - shiftSamples], 5);
  });

  it("applies the left-channel shift independently", () => {
    const base = noise();
    const out = autoPhaseCorrect(stereo(base, base), { mode: "global", leftShiftMs: (9 / SR) * 1000 });
    for (let i = 200; i < base.length; i++) expect(out.channels[0][i]).toBeCloseTo(base[i - 9], 5);
  });
});

describe("autoPhaseCorrect — robustness", () => {
  it("passes mono (and non-stereo) buffers through unchanged", () => {
    const mono: AudioData = { sampleRate: SR, channels: [noise()] };
    const out = autoPhaseCorrect(mono, { maxShiftMs: 5 });
    expect(out.channels.length).toBe(1);
    expect(maxAbsDiff(out.channels[0], mono.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const base = noise();
    const d = stereo(base, delayBy(base, 20));
    const snapR = Float32Array.from(d.channels[1]);
    autoPhaseCorrect(d, { maxShiftMs: 5 });
    expect(maxAbsDiff(d.channels[1], snapR)).toBe(0);
  });

  it("preserves frame count and is deterministic", () => {
    const base = noise();
    const d = stereo(base, delayBy(base, 15));
    const a = autoPhaseCorrect(d, { maxShiftMs: 5 });
    const b = autoPhaseCorrect(d, { maxShiftMs: 5 });
    expect(frameCount(a)).toBe(frameCount(d));
    expect(maxAbsDiff(a.channels[1], b.channels[1])).toBe(0);
  });

  it("handles an empty stereo buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = autoPhaseCorrect(empty, { maxShiftMs: 5 });
    expect(frameCount(out)).toBe(0);
    expect(out.channels.length).toBe(2);
  });
});
