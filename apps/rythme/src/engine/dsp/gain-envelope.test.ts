// ─────────────────────────────────────────────────────────────
// engine/dsp/gain-envelope.test — Audition-style Fade / Gain Envelope
// ─────────────────────────────────────────────────────────────
// Pins the envelope math: the curve passes through every control point (linear
// and spline), interpolates linearly between them, fades/boosts the signal by
// the drawn shape, and a flat or empty envelope is a passthrough.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { gainEnvelope, gainEnvelopeAt, type GainEnvelopePoint } from "./gain-envelope";

const SR = 44100;

/** A DC-unity signal (all ones) makes the output equal the envelope itself. */
function ones(n: number, channels = 1): AudioData {
  return { sampleRate: SR, channels: Array.from({ length: channels }, () => new Float32Array(n).fill(1)) };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("gainEnvelopeAt", () => {
  const pts: GainEnvelopePoint[] = [{ time: 0, gain: 0 }, { time: 0.5, gain: 1 }, { time: 1, gain: 0.25 }];

  it("passes through every control point (linear and spline)", () => {
    for (const interp of ["linear", "spline"] as const) {
      expect(gainEnvelopeAt(pts, 0, interp)).toBeCloseTo(0, 6);
      expect(gainEnvelopeAt(pts, 0.5, interp)).toBeCloseTo(1, 6);
      expect(gainEnvelopeAt(pts, 1, interp)).toBeCloseTo(0.25, 6);
    }
  });

  it("interpolates linearly between points", () => {
    expect(gainEnvelopeAt(pts, 0.25, "linear")).toBeCloseTo(0.5, 6); // halfway 0→1
    expect(gainEnvelopeAt(pts, 0.75, "linear")).toBeCloseTo(0.625, 6); // halfway 1→0.25
  });

  it("holds the end values outside the points' range", () => {
    expect(gainEnvelopeAt([{ time: 0.2, gain: 0.4 }, { time: 0.8, gain: 0.9 }], 0, "linear")).toBe(0.4);
    expect(gainEnvelopeAt([{ time: 0.2, gain: 0.4 }, { time: 0.8, gain: 0.9 }], 1, "linear")).toBe(0.9);
  });

  it("returns unity for no points and the single gain for one point", () => {
    expect(gainEnvelopeAt([], 0.5)).toBe(1);
    expect(gainEnvelopeAt([{ time: 0, gain: 0.7 }], 0.5)).toBe(0.7);
  });

  it("spline overshoots a linear ramp's midpoint on a curved shape", () => {
    // For a symmetric hump, the spline bulges above the straight-line value.
    const hump: GainEnvelopePoint[] = [{ time: 0, gain: 0 }, { time: 0.5, gain: 1 }, { time: 1, gain: 0 }];
    expect(gainEnvelopeAt(hump, 0.25, "spline")).toBeGreaterThan(gainEnvelopeAt(hump, 0.25, "linear"));
  });
});

describe("gainEnvelope", () => {
  it("applies a linear fade-out (gain 1 → 0)", () => {
    const d = ones(1001);
    const out = gainEnvelope(d, { points: [{ time: 0, gain: 1 }, { time: 1, gain: 0 }] });
    expect(out.channels[0][0]).toBeCloseTo(1, 5);
    expect(out.channels[0][500]).toBeCloseTo(0.5, 3);
    expect(out.channels[0][1000]).toBeCloseTo(0, 5);
  });

  it("applies a fade-in (gain 0 → 1)", () => {
    const d = ones(1001);
    const out = gainEnvelope(d, { points: [{ time: 0, gain: 0 }, { time: 1, gain: 1 }] });
    expect(out.channels[0][0]).toBeCloseTo(0, 5);
    expect(out.channels[0][1000]).toBeCloseTo(1, 5);
  });

  it("ducks the middle and restores the ends", () => {
    const d = ones(1001);
    const out = gainEnvelope(d, { points: [{ time: 0, gain: 1 }, { time: 0.5, gain: 0.2 }, { time: 1, gain: 1 }] });
    expect(out.channels[0][0]).toBeCloseTo(1, 5);
    expect(out.channels[0][500]).toBeCloseTo(0.2, 3);
    expect(out.channels[0][1000]).toBeCloseTo(1, 5);
  });

  it("boosts when a control point exceeds unity", () => {
    const d = ones(1001);
    const out = gainEnvelope(d, { points: [{ time: 0, gain: 1 }, { time: 1, gain: 2 }] });
    expect(out.channels[0][1000]).toBeCloseTo(2, 4);
  });

  it("scales a real tone's settled level by the envelope", () => {
    const t = sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const out = gainEnvelope(t, { points: [{ time: 0, gain: 1 }, { time: 1, gain: 0 }] });
    // Near the end the envelope ≈ 0, so the samples collapse toward silence.
    const tail = out.channels[0].subarray(out.channels[0].length - 50);
    let peak = 0;
    for (const v of tail) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(0.05);
  });

  it("is a passthrough for a flat unity envelope and for <2 points", () => {
    const t = sine(440, 0.1, { sampleRate: SR, amplitude: 0.5 });
    const flat = gainEnvelope(t, { points: [{ time: 0, gain: 1 }, { time: 1, gain: 1 }] });
    expect(maxAbsDiff(flat.channels[0], t.channels[0])).toBeLessThan(1e-6);
    const single = gainEnvelope(t, { points: [{ time: 0, gain: 0.5 }] });
    expect(maxAbsDiff(single.channels[0], t.channels[0])).toBe(0); // <2 points → untouched
  });

  it("applies the same envelope to every channel", () => {
    const d = ones(1001, 2);
    const out = gainEnvelope(d, { points: [{ time: 0, gain: 1 }, { time: 1, gain: 0 }] });
    expect(out.channels[0][1000]).toBeCloseTo(0, 5);
    expect(out.channels[1][1000]).toBeCloseTo(0, 5);
  });

  it("does not mutate the input, preserves frame count, is deterministic", () => {
    const t = sine(1000, 0.1, { sampleRate: SR, amplitude: 0.5 });
    const snapshot = Float32Array.from(t.channels[0]);
    const pts = { points: [{ time: 0, gain: 1 }, { time: 0.5, gain: 0.3 }, { time: 1, gain: 1 }], interpolation: "spline" as const };
    const a = gainEnvelope(t, pts);
    const b = gainEnvelope(t, pts);
    expect(maxAbsDiff(t.channels[0], snapshot)).toBe(0);
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = gainEnvelope(empty, { points: [{ time: 0, gain: 1 }, { time: 1, gain: 0 }] });
    expect(frameCount(out)).toBe(0);
  });
});
