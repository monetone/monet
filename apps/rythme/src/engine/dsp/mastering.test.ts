// ─────────────────────────────────────────────────────────────
// engine/dsp/mastering.test — Audition-style Mastering rack
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { analyzeLevels } from "../analysis/levels";
import { highpass } from "./filter";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { mastering } from "./mastering";

const SR = 44100;

const stereoTone = (amp: number, freq = 440) => sine(freq, 0.3, { sampleRate: SR, amplitude: amp, channels: 2 });

function rmsRange(ch: Float32Array, start: number, end: number): number {
  let s = 0;
  for (let i = start; i < end; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

/** High-frequency fraction of the energy (>6 kHz RMS / total RMS) — brightness. */
function brightness(d: AudioData): number {
  const hi = analyzeLevels(highpass(d, 6000, Math.SQRT1_2, 2)).rms;
  return hi / (analyzeLevels(d).rms + 1e-12);
}

/** Side/mid RMS ratio — stereo width. */
function sideMidRatio(d: AudioData): number {
  const l = d.channels[0];
  const r = d.channels[1];
  let sideSumSq = 0;
  let midSumSq = 0;
  for (let i = 0; i < l.length; i++) {
    const s = (l[i] - r[i]) / 2;
    const m = (l[i] + r[i]) / 2;
    sideSumSq += s * s;
    midSumSq += m * m;
  }
  return Math.sqrt(sideSumSq) / (Math.sqrt(midSumSq) + 1e-12); // length cancels in the ratio
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentMaxAbsDiff(a: AudioData, b: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * a.sampleRate));
  const end = Math.min(frameCount(a), frameCount(b), Math.round(endSeconds * a.sampleRate));
  let m = 0;
  const channels = Math.min(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c++) {
    for (let i = start; i < end; i++) m = Math.max(m, Math.abs(a.channels[c][i] - b.channels[c][i]));
  }
  return m;
}

describe("mastering", () => {
  it("raises loudness on a moderate signal", () => {
    const s = stereoTone(0.15);
    const out = mastering(s, {});
    expect(analyzeLevels(out).rms).toBeGreaterThan(analyzeLevels(s).rms);
  });

  it("keeps the peak at/under the ceiling on a hot signal", () => {
    const s = stereoTone(0.9);
    const out = mastering(s, { ceilingDb: -1 });
    // The look-ahead maximizer guarantees the ceiling is never overshot.
    expect(analyzeLevels(out).peak).toBeLessThanOrEqual(dbToGain(-1) + 1e-4);
  });

  it("brightens the spectrum (EQ tilt + exciter)", () => {
    const s: AudioData = { sampleRate: SR, channels: [whiteNoise(0.3, { sampleRate: SR, amplitude: 0.2, seed: 1 }).channels[0], whiteNoise(0.3, { sampleRate: SR, amplitude: 0.2, seed: 2 }).channels[0]] };
    const out = mastering(s, {});
    expect(brightness(out)).toBeGreaterThan(brightness(s));
  });

  it("widens the stereo image (side/mid ratio up)", () => {
    // Distinct L/R so there is genuine side content to widen.
    const l = sine(300, 0.3, { sampleRate: SR, amplitude: 0.3 }).channels[0];
    const r = sine(330, 0.3, { sampleRate: SR, amplitude: 0.3 }).channels[0];
    const s: AudioData = { sampleRate: SR, channels: [l, r] };
    const out = mastering(s, { width: 1.5 });
    expect(sideMidRatio(out)).toBeGreaterThan(sideMidRatio(s));
  });

  it("keeps the dry/wet blend in range on a hot signal at partial amount", () => {
    const s = stereoTone(0.95);
    const out = mastering(s, { amount: 0.5, ceilingDb: -1 });
    expect(analyzeLevels(out).peak).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("is an exact passthrough at amount 0", () => {
    const s = stereoTone(0.3);
    const out = mastering(s, { amount: 0 });
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBe(0);
    expect(maxAbsDiff(out.channels[1], s.channels[1])).toBe(0);
  });

  it("applies amount automation after the wet mastering chain", () => {
    const s = sine(440, 1, { sampleRate: SR, amplitude: 0.25, channels: 2 });
    const wet = mastering(s, { amount: 1 });
    const out = mastering(s, {
      amount: 0,
      automation: { amount: (time) => (time < 0.5 ? 0 : 1) },
    });

    expect(segmentMaxAbsDiff(out, s, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
  });

  it("applies low-shelf automation in the mastering EQ stage", () => {
    const s = sine(80, 1, { sampleRate: SR, amplitude: 0.08, channels: 2 });
    const base = { lowShelfDb: 0, highShelfDb: 0, exciteAmount: 0, width: 1, driveDb: 0, ceilingDb: 0, amount: 1 };
    const out = mastering(s, {
      ...base,
      automation: { lowShelfDb: (time, fallback) => (time < 0.5 ? fallback : 6) },
    });
    const flat = mastering(s, base);
    const boosted = mastering(s, { ...base, lowShelfDb: 6 });

    expect(segmentMaxAbsDiff(out, flat, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, boosted, 0.8, 0.95)).toBeLessThan(1e-4);
    expect(segmentMaxAbsDiff(flat, boosted, 0.8, 0.95)).toBeGreaterThan(0.01);
  });

  it("applies high-shelf automation in the mastering EQ stage", () => {
    const s = sine(10000, 1, { sampleRate: SR, amplitude: 0.08, channels: 2 });
    const base = { lowShelfDb: 0, highShelfDb: 0, exciteAmount: 0, width: 1, driveDb: 0, ceilingDb: 0, amount: 1 };
    const out = mastering(s, {
      ...base,
      automation: { highShelfDb: (time, fallback) => (time < 0.5 ? fallback : 6) },
    });
    const flat = mastering(s, base);
    const boosted = mastering(s, { ...base, highShelfDb: 6 });

    expect(segmentMaxAbsDiff(out, flat, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, boosted, 0.8, 0.95)).toBeLessThan(1e-4);
    expect(segmentMaxAbsDiff(flat, boosted, 0.8, 0.95)).toBeGreaterThan(0.01);
  });

  it("applies excite amount automation inside the mastering chain", () => {
    const s = sine(5000, 1, { sampleRate: SR, amplitude: 0.3, channels: 2 });
    const base = { lowShelfDb: 0, highShelfDb: 0, exciteAmount: 0, width: 1, driveDb: 0, ceilingDb: 0, amount: 1 };
    const out = mastering(s, {
      ...base,
      automation: { exciteAmount: (time, fallback) => (time < 0.5 ? fallback : 0.8) },
    });
    const low = mastering(s, base);
    const high = mastering(s, { ...base, exciteAmount: 0.8 });

    expect(segmentMaxAbsDiff(out, low, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, high, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(low, high, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("applies width automation in the mid-side mastering stage", () => {
    const left = sine(330, 1, { sampleRate: SR, amplitude: 0.2 }).channels[0];
    const right = sine(440, 1, { sampleRate: SR, amplitude: 0.2 }).channels[0];
    const s: AudioData = { sampleRate: SR, channels: [left, right] };
    const base = { lowShelfDb: 0, highShelfDb: 0, exciteAmount: 0, width: 1, driveDb: 0, ceilingDb: 0, amount: 1 };
    const out = mastering(s, {
      ...base,
      automation: { width: (time, fallback) => (time < 0.5 ? fallback : 2) },
    });
    const normal = mastering(s, base);
    const wide = mastering(s, { ...base, width: 2 });

    expect(segmentMaxAbsDiff(out, normal, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, wide, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(normal, wide, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("applies ambience automation before the loudness maximizer", () => {
    const s = sine(440, 0.24, { sampleRate: SR, amplitude: 0.15, channels: 2 });
    const base = {
      lowShelfDb: 0,
      highShelfDb: 0,
      exciteAmount: 0,
      width: 1,
      ambience: 0,
      ambienceDecayMs: 40,
      ambiencePreDelayMs: 0,
      driveDb: 0,
      ceilingDb: 0,
      amount: 1,
    };
    const out = mastering(s, {
      ...base,
      automation: { ambience: (time, fallback) => (time < 0.12 ? fallback : 0.4) },
    });
    const dry = mastering(s, base);
    const wet = mastering(s, { ...base, ambience: 0.4 });

    expect(frameCount(out)).toBeGreaterThan(frameCount(s));
    expect(segmentMaxAbsDiff(out, dry, 0.04, 0.1)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, wet, 0.15, 0.22)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(dry, wet, 0.15, 0.22)).toBeGreaterThan(0.01);
  });

  it("passes drive automation into the loudness maximizer", () => {
    const s = sine(440, 1, { sampleRate: SR, amplitude: 0.08, channels: 2 });
    const out = mastering(s, {
      lowShelfDb: 0,
      highShelfDb: 0,
      exciteAmount: 0,
      width: 1,
      driveDb: 0,
      ceilingDb: -1,
      amount: 1,
      automation: { driveDb: (time) => (time < 0.5 ? 0 : 12) },
    });

    const first = rmsRange(out.channels[0], Math.round(0.15 * SR), Math.round(0.45 * SR));
    const second = rmsRange(out.channels[0], Math.round(0.75 * SR), Math.round(0.95 * SR));

    expect(second).toBeGreaterThan(first * 3);
    expect(analyzeLevels(out).peak).toBeLessThanOrEqual(dbToGain(-1) + 1e-4);
  });

  it("passes ceiling automation into the loudness maximizer", () => {
    const s = sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 });
    const out = mastering(s, {
      lowShelfDb: 0,
      highShelfDb: 0,
      exciteAmount: 0,
      width: 1,
      driveDb: 0,
      ceilingDb: 0,
      amount: 1,
      automation: { ceilingDb: (time) => (time < 0.5 ? 0 : -20) },
    });

    const first = rmsRange(out.channels[0], Math.round(0.15 * SR), Math.round(0.45 * SR));
    const second = rmsRange(out.channels[0], Math.round(0.75 * SR), Math.round(0.95 * SR));

    expect(first).toBeGreaterThan(0.45);
    expect(second).toBeLessThan(first * 0.2);
  });

  it("preserves frame and channel count and is deterministic", () => {
    const s = stereoTone(0.3);
    const a = mastering(s, {});
    const b = mastering(s, {});
    expect(frameCount(a)).toBe(frameCount(s));
    expect(channelCount(a)).toBe(2);
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("adds an optional ambience tail before the maximizer", () => {
    const s = stereoTone(0.25);
    const out = mastering(s, { ambience: 0.35, ambienceDecayMs: 180, ambiencePreDelayMs: 4, ceilingDb: -1 });
    expect(frameCount(out)).toBeGreaterThan(frameCount(s));
    expect(rmsRange(out.channels[0], frameCount(s), frameCount(out))).toBeGreaterThan(1e-5);
    expect(analyzeLevels(out).peak).toBeLessThanOrEqual(dbToGain(-1) + 1e-4);
  });

  it("handles a mono signal (stays mono, still louder)", () => {
    const mono = sine(440, 0.3, { sampleRate: SR, amplitude: 0.15 });
    const out = mastering(mono, {});
    expect(channelCount(out)).toBe(1);
    expect(analyzeLevels(out).rms).toBeGreaterThan(analyzeLevels(mono).rms);
  });

  it("does not mutate the input", () => {
    const s = stereoTone(0.5);
    const snap = Float32Array.from(s.channels[0]);
    mastering(s, {});
    expect(maxAbsDiff(s.channels[0], snap)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = mastering(empty, {});
    expect(frameCount(out)).toBe(0);
  });
});
