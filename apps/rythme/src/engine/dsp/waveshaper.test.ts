// ─────────────────────────────────────────────────────────────
// engine/dsp/waveshaper.test — Audition-style Distortion (transfer curve)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { magnitudes } from "../analysis/fft";
import { sine } from "../generate/tone";
import { type CurvePoint, waveshapeCurve, waveshaper } from "./waveshaper";

const SR = 44100;
const FFT = 8192;

// A symmetric hard clipper at ±0.5 expressed as a transfer curve.
const HARD_CLIP_HALF: CurvePoint[] = [
  { in: -1, out: -0.5 },
  { in: -0.5, out: -0.5 },
  { in: 0.5, out: 0.5 },
  { in: 1, out: 0.5 },
];

const buffer = (samples: number[]): AudioData => ({ sampleRate: SR, channels: [Float32Array.from(samples)] });

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentMaxAbsDiff(a: Float32Array, b: Float32Array, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * SR));
  const end = Math.min(a.length, b.length, Math.round(endSeconds * SR));
  let m = 0;
  for (let i = start; i < end; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Raw-FFT magnitude at `freq`; callers must place `freq` on an exact bin. */
function magAt(ch: Float32Array, freq: number): number {
  return magnitudes(ch, FFT)[Math.round((freq * FFT) / SR)];
}

describe("waveshapeCurve", () => {
  it("is the identity for the default/identity curve across the range", () => {
    for (const x of [-1, -0.6, -0.25, 0, 0.25, 0.6, 1]) {
      expect(waveshapeCurve([{ in: -1, out: -1 }, { in: 1, out: 1 }], x)).toBeCloseTo(x, 12);
    }
  });

  it("piecewise-linearly interpolates between points", () => {
    // (0,0)→(1,0.5): halfway in maps halfway out.
    expect(waveshapeCurve([{ in: -1, out: -1 }, { in: 0, out: 0 }, { in: 1, out: 0.5 }], 0.5)).toBeCloseTo(0.25, 12);
  });

  it("applies a hard-clip curve and saturates outside the domain", () => {
    expect(waveshapeCurve(HARD_CLIP_HALF, 0.8)).toBeCloseTo(0.5, 12); // clipped
    expect(waveshapeCurve(HARD_CLIP_HALF, 0.3)).toBeCloseTo(0.3, 12); // linear region
    expect(waveshapeCurve(HARD_CLIP_HALF, -0.9)).toBeCloseTo(-0.5, 12); // clipped
    expect(waveshapeCurve(HARD_CLIP_HALF, 1.5)).toBeCloseTo(0.5, 12); // out-of-domain → endpoint
    expect(waveshapeCurve(HARD_CLIP_HALF, -2)).toBeCloseTo(-0.5, 12);
  });

  it("falls back to identity for a degenerate (<2-point) curve", () => {
    expect(waveshapeCurve([], 0.42)).toBeCloseTo(0.42, 12);
    expect(waveshapeCurve([{ in: 0, out: 1 }], -0.3)).toBeCloseTo(-0.3, 12);
  });

  it("ignores point order (sorts internally)", () => {
    const scrambled: CurvePoint[] = [{ in: 1, out: 0.5 }, { in: -0.5, out: -0.5 }, { in: -1, out: -0.5 }, { in: 0.5, out: 0.5 }];
    expect(waveshapeCurve(scrambled, 0.8)).toBeCloseTo(0.5, 12);
  });

  it("resolves duplicate input points deterministically and finitely", () => {
    const dup: CurvePoint[] = [{ in: -1, out: -1 }, { in: 0, out: 0.2 }, { in: 0, out: 0.8 }, { in: 1, out: 1 }];
    const a = waveshapeCurve(dup, 0);
    const b = waveshapeCurve(dup, 0);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBe(b); // deterministic
    expect(a).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(a).toBeLessThanOrEqual(0.8 + 1e-9); // stays between the duplicate outputs
  });
});

describe("waveshaper", () => {
  it("is an exact passthrough for the identity curve", () => {
    const t = sine(440, 0.2, { sampleRate: SR, amplitude: 0.7 });
    const out = waveshaper(t, {});
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-6);
  });

  it("is an exact passthrough at mix 0 regardless of curve", () => {
    const t = sine(440, 0.2, { sampleRate: SR, amplitude: 0.7 });
    const out = waveshaper(t, { curve: HARD_CLIP_HALF, driveDb: 12, mix: 0 });
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBe(0);
  });

  it("applies transfer-curve automation per sample", () => {
    const t = sine(440, 1, { sampleRate: SR, amplitude: 0.9 });
    const out = waveshaper(t, {
      curve: [{ in: -1, out: -1 }, { in: 1, out: 1 }],
      mix: 1,
      automation: { curve: (time, fallback) => (time < 0.5 ? fallback : HARD_CLIP_HALF) },
    });
    const clipped = waveshaper(t, { curve: HARD_CLIP_HALF, mix: 1 });

    expect(segmentMaxAbsDiff(out.channels[0], t.channels[0], 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], clipped.channels[0], 0.65, 0.95)).toBeLessThan(1e-6);
  });

  it("maps a known buffer through the curve sample-for-sample", () => {
    const out = waveshaper(buffer([-0.9, -0.3, 0.3, 0.9]), { curve: HARD_CLIP_HALF });
    expect(Array.from(out.channels[0])).toEqual(
      [-0.5, -0.3, 0.3, 0.5].map((v) => expect.closeTo(v, 6)),
    );
  });

  it("generates odd-harmonic energy when clipping a loud sine", () => {
    // Land f (and 3f) on exact FFT bins so the raw FFT is leakage-free.
    const f = (186 * SR) / FFT; // ≈ 1001 Hz, bin 186
    const t = sine(f, FFT / SR, { sampleRate: SR, amplitude: 0.9 });
    const out = waveshaper(t, { curve: HARD_CLIP_HALF });
    const dry3f = magAt(t.channels[0], 3 * f);
    const wet3f = magAt(out.channels[0], 3 * f);
    expect(wet3f).toBeGreaterThan(dry3f * 20 + 1e-2);
  });

  it("never exceeds the curve's ceiling (mix 1)", () => {
    const t = sine(300, 0.2, { sampleRate: SR, amplitude: 1 });
    const out = waveshaper(t, { curve: HARD_CLIP_HALF, driveDb: 18 });
    let peak = 0;
    for (const v of out.channels[0]) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("preserves frame count and is deterministic", () => {
    const t = sine(440, 0.2, { sampleRate: SR, amplitude: 0.8 });
    const a = waveshaper(t, { curve: HARD_CLIP_HALF, driveDb: 6 });
    const b = waveshaper(t, { curve: HARD_CLIP_HALF, driveDb: 6 });
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const t = sine(440, 0.2, { sampleRate: SR, amplitude: 0.8 });
    const snap = Float32Array.from(t.channels[0]);
    waveshaper(t, { curve: HARD_CLIP_HALF, driveDb: 6 });
    expect(maxAbsDiff(t.channels[0], snap)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const out = waveshaper(createAudioData(1, 0, SR), { curve: HARD_CLIP_HALF });
    expect(frameCount(out)).toBe(0);
  });

  it("sanitizes non-finite input samples to a finite output", () => {
    const out = waveshaper(buffer([NaN, Infinity, -Infinity, 0.3]), { curve: HARD_CLIP_HALF, mix: 1 });
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
    expect(out.channels[0][3]).toBeCloseTo(0.3, 6); // the finite sample still shapes normally
  });
});
