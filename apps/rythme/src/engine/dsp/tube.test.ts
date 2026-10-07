// ─────────────────────────────────────────────────────────────
// engine/dsp/tube.test — Audition-style Tube-modeled Compressor
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { spectrum } from "../analysis/spectrum";
import { rmsAmplitude } from "./normalize";
import { tubeCompress } from "./tube";

const SR = 44100;

/** Magnitude (dB) at the bin nearest `freq`. */
function dbAt(d: AudioData, freq: number): number {
  const { freqs, db } = spectrum(d, { fftSize: 8192 });
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < freqs.length; i++) {
    const dist = Math.abs(freqs[i] - freq);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return db[best];
}

function segmentMaxAbsDiff(a: Float32Array, b: Float32Array, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * SR));
  const end = Math.min(a.length, b.length, Math.round(endSeconds * SR));
  let m = 0;
  for (let i = start; i < end; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("tubeCompress", () => {
  it("tube warmth generates a strong even (2nd) harmonic", () => {
    const tone = sine(440, 0.3, { sampleRate: SR, amplitude: 0.5 });
    const warm = tubeCompress(tone, { driveDb: 12, warmth: 0.5, ratio: 1, thresholdDb: 0 }); // ratio 1 → no compression
    const flat = tubeCompress(tone, { driveDb: 12, warmth: 0, ratio: 1, thresholdDb: 0 }); // symmetric → odd only
    expect(dbAt(warm, 880) - dbAt(flat, 880)).toBeGreaterThan(12);
    expect(dbAt(warm, 440)).toBeGreaterThan(dbAt(warm, 880)); // fundamental still dominant
  });

  it("the compressor stage reduces dynamics (ratio 8 quieter than ratio 1)", () => {
    const loud = sine(440, 0.4, { sampleRate: SR, amplitude: 0.9 });
    const comp = tubeCompress(loud, { driveDb: 0, warmth: 0, ratio: 8, thresholdDb: -30, makeupDb: 0 });
    const none = tubeCompress(loud, { driveDb: 0, warmth: 0, ratio: 1, thresholdDb: -30, makeupDb: 0 });
    expect(rmsAmplitude(comp)).toBeLessThan(rmsAmplitude(none));
  });

  it("applies tube drive and warmth automation before compression", () => {
    const tone = sine(440, 1, { sampleRate: SR, amplitude: 0.6 });
    const low = tubeCompress(tone, { driveDb: 0, warmth: 0, ratio: 1, thresholdDb: 0, makeupDb: 0 });
    const high = tubeCompress(tone, { driveDb: 18, warmth: 0.8, ratio: 1, thresholdDb: 0, makeupDb: 0 });
    const out = tubeCompress(tone, {
      driveDb: 0,
      warmth: 0,
      ratio: 1,
      thresholdDb: 0,
      makeupDb: 0,
      automation: {
        driveDb: (time) => (time < 0.5 ? 0 : 18),
        warmth: (time) => (time < 0.5 ? 0 : 0.8),
      },
    });

    expect(segmentMaxAbsDiff(out.channels[0], low.channels[0], 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], high.channels[0], 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(low.channels[0], high.channels[0], 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("gentle settings barely change a quiet signal", () => {
    const quiet = sine(440, 0.2, { sampleRate: SR, amplitude: 0.1 });
    const out = tubeCompress(quiet, { driveDb: 0, warmth: 0, ratio: 1, thresholdDb: 0 });
    expect(Math.abs(rmsAmplitude(out) / rmsAmplitude(quiet) - 1)).toBeLessThan(0.03);
  });

  it("stays finite at extreme drive/warmth (no NaN)", () => {
    const tone = sine(440, 0.2, { sampleRate: SR, amplitude: 0.8 });
    const out = tubeCompress(tone, { driveDb: 24, warmth: 1, ratio: 20, thresholdDb: -40 });
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });

  it("preserves channel + frame count and processes stereo", () => {
    const tone = sine(440, 0.2, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const out = tubeCompress(tone, { driveDb: 9, warmth: 0.3 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(tone));
  });

  it("is deterministic", () => {
    const tone = sine(440, 0.2, { sampleRate: SR, amplitude: 0.6 });
    const a = tubeCompress(tone, { driveDb: 9, warmth: 0.4, ratio: 4 });
    const b = tubeCompress(tone, { driveDb: 9, warmth: 0.4, ratio: 4 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const tone = sine(440, 0.15, { sampleRate: SR, amplitude: 0.7 });
    const copy = Array.from(tone.channels[0]);
    tubeCompress(tone, { driveDb: 12, warmth: 0.5, ratio: 6 });
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = tubeCompress(createAudioData(2, 0, SR), { driveDb: 9 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
