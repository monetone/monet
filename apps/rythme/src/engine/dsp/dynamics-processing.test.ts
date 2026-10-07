// ─────────────────────────────────────────────────────────────
// engine/dsp/dynamics-processing.test — Audition-style Dynamics Processing
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { dynamicsProcessing, dynamicsTransferDb, type DynamicsPoint } from "./dynamics-processing";

const SR = 44100;

// Classic transfer-curve archetypes.
const COMPRESSOR: DynamicsPoint[] = [{ inputDb: -60, outputDb: -60 }, { inputDb: -24, outputDb: -24 }, { inputDb: 0, outputDb: -18 }]; // 4:1 above -24
const LIMITER: DynamicsPoint[] = [{ inputDb: -60, outputDb: -60 }, { inputDb: -6, outputDb: -6 }, { inputDb: 0, outputDb: -6 }]; // ceiling -6
const GATE: DynamicsPoint[] = [{ inputDb: -90, outputDb: -120 }, { inputDb: -50, outputDb: -120 }, { inputDb: -45, outputDb: -45 }, { inputDb: 0, outputDb: 0 }];
const EXPANDER: DynamicsPoint[] = [{ inputDb: -60, outputDb: -80 }, { inputDb: -40, outputDb: -40 }, { inputDb: 0, outputDb: 0 }]; // 2:1 down below -40

const tone = (amp: number, dur = 0.2, freq = 440): AudioData => sine(freq, dur, { sampleRate: SR, amplitude: amp });

/** Peak magnitude over the settled (second-half) region, past detector ramp-up. */
function settledPeak(ch: Float32Array): number {
  let m = 0;
  for (let i = ch.length >> 1; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]));
  return m;
}

function peak(ch: Float32Array): number {
  let m = 0;
  for (let i = 0; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]));
  return m;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("dynamicsTransferDb", () => {
  it("is exact at the control points", () => {
    expect(dynamicsTransferDb(COMPRESSOR, -24)).toBeCloseTo(-24, 9);
    expect(dynamicsTransferDb(COMPRESSOR, 0)).toBeCloseTo(-18, 9);
  });

  it("interpolates linearly between points", () => {
    // Halfway between (-24,-24) and (0,-18): -24 + 0.5·6 = -21
    expect(dynamicsTransferDb(COMPRESSOR, -12)).toBeCloseTo(-21, 9);
  });

  it("extrapolates along the first and last segment beyond the ends", () => {
    // Below the first point, the slope-1 segment continues: input == output.
    expect(dynamicsTransferDb(COMPRESSOR, -72)).toBeCloseTo(-72, 9);
    // Above the last point, the 0.25-slope segment continues: 0 → -18, +6 → -16.5
    expect(dynamicsTransferDb(COMPRESSOR, 6)).toBeCloseTo(-16.5, 9);
  });

  it("does not divide by zero on duplicate input-dB points", () => {
    const dup: DynamicsPoint[] = [{ inputDb: -10, outputDb: -10 }, { inputDb: -10, outputDb: -30 }, { inputDb: 0, outputDb: 0 }];
    const y = dynamicsTransferDb(dup, -10);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe("dynamicsProcessing", () => {
  it("identity curve is an exact passthrough", () => {
    const s = tone(0.5);
    const out = dynamicsProcessing(s, {});
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBeLessThan(1e-7);
  });

  it("a compressor curve reduces a loud tone but leaves a quiet tone unchanged", () => {
    const loud = tone(0.9);
    const outLoud = dynamicsProcessing(loud, { curve: COMPRESSOR });
    expect(settledPeak(outLoud.channels[0])).toBeLessThan(settledPeak(loud.channels[0]) * 0.5);

    const quiet = tone(0.003); // ≈ −50 dBFS, on the slope-1 part of the curve
    const outQuiet = dynamicsProcessing(quiet, { curve: COMPRESSOR });
    const inQ = settledPeak(quiet.channels[0]);
    expect(settledPeak(outQuiet.channels[0])).toBeGreaterThan(inQ * 0.9);
    expect(settledPeak(outQuiet.channels[0])).toBeLessThan(inQ * 1.1);
  });

  it("a limiter curve caps a hot tone near the ceiling", () => {
    const hot = tone(1.0);
    const out = dynamicsProcessing(hot, { curve: LIMITER, gainAttackMs: 1 });
    const p = settledPeak(out.channels[0]);
    // ceiling −6 dBFS → ~0.501 linear
    expect(p).toBeGreaterThan(0.42);
    expect(p).toBeLessThan(0.58);
    expect(p).toBeLessThan(settledPeak(hot.channels[0]));
  });

  it("a gate curve silences a tone below the knee and passes one above it", () => {
    const below = tone(0.002); // ≈ −54 dBFS, under the −50 knee
    const outBelow = dynamicsProcessing(below, { curve: GATE });
    expect(settledPeak(outBelow.channels[0])).toBeLessThan(settledPeak(below.channels[0]) * 0.1);

    const above = tone(0.5); // ≈ −6 dBFS, in the slope-1 pass region
    const outAbove = dynamicsProcessing(above, { curve: GATE });
    expect(settledPeak(outAbove.channels[0])).toBeGreaterThan(0.4);
  });

  it("an expander curve pushes a quiet tone further down", () => {
    const quiet = tone(0.00316); // ≈ −50 dBFS
    const out = dynamicsProcessing(quiet, { curve: EXPANDER });
    expect(settledPeak(out.channels[0])).toBeLessThan(settledPeak(quiet.channels[0]) * 0.5);
  });

  it("applies one linked gain to both channels (stereo image preserved)", () => {
    const l = tone(0.9).channels[0];
    const r = tone(0.05, 0.2, 441).channels[0]; // quiet, slightly detuned so zeros rarely coincide
    const s: AudioData = { sampleRate: SR, channels: [l, r] };
    const out = dynamicsProcessing(s, { curve: COMPRESSOR });
    // Same per-sample gain g ⇒ outL·inR == outR·inL exactly (no division, robust at zeros).
    let cross = 0;
    for (let i = 0; i < l.length; i++) {
      cross = Math.max(cross, Math.abs(out.channels[0][i] * r[i] - out.channels[1][i] * l[i]));
    }
    expect(cross).toBeLessThan(1e-7);
  });

  it("makeup gain raises the level (identity curve)", () => {
    const s = tone(0.1);
    const out = dynamicsProcessing(s, { makeupDb: 6 });
    const ratio = settledPeak(out.channels[0]) / settledPeak(s.channels[0]);
    expect(ratio).toBeCloseTo(Math.pow(10, 6 / 20), 3); // ≈ 1.995×
  });

  it("preserves frame and channel count", () => {
    const s: AudioData = { sampleRate: SR, channels: [tone(0.5).channels[0], tone(0.5, 0.2, 441).channels[0]] };
    const out = dynamicsProcessing(s, { curve: COMPRESSOR });
    expect(frameCount(out)).toBe(frameCount(s));
    expect(channelCount(out)).toBe(2);
  });

  it("is deterministic", () => {
    const s = tone(0.8);
    const a = dynamicsProcessing(s, { curve: COMPRESSOR });
    const b = dynamicsProcessing(s, { curve: COMPRESSOR });
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const s = tone(0.9);
    const snapshot = Float32Array.from(s.channels[0]);
    dynamicsProcessing(s, { curve: LIMITER });
    expect(maxAbsDiff(s.channels[0], snapshot)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = dynamicsProcessing(empty, { curve: COMPRESSOR });
    expect(frameCount(out)).toBe(0);
    expect(peak(out.channels[0] ?? new Float32Array(0))).toBe(0);
  });
});
