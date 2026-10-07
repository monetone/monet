// ─────────────────────────────────────────────────────────────
// engine/dsp/convert-sample-type.test — Audition-style Convert Sample Type
// ─────────────────────────────────────────────────────────────
// Pins the conversions: stereo→mono mixes by Left/Right Mix, mono→stereo
// duplicates, a lower bit depth snaps every sample onto the 2^(N−1) grid, dither
// keeps it on the grid but decorrelated (and deterministic), and a no-op leaves
// the buffer untouched.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { convertSampleType } from "./convert-sample-type";

const SR = 44100;

function stereo(lAmp = 0.7, rScale = 0.4): AudioData {
  const s = sine(1000, 0.05, { sampleRate: SR, amplitude: lAmp, channels: 2 });
  for (let i = 0; i < s.channels[1].length; i++) s.channels[1][i] *= rScale; // make R differ from L
  return s;
}
const mono = () => sine(1000, 0.05, { sampleRate: SR, amplitude: 0.7 });

/** Max distance of any sample from the nearest multiple of `step`. */
function gridError(ch: Float32Array, step: number): number {
  let m = 0;
  for (const v of ch) m = Math.max(m, Math.abs(v / step - Math.round(v / step)));
  return m;
}
function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("convertSampleType — channels", () => {
  it("stereo → mono mixes 50/50 by default", () => {
    const s = stereo();
    const out = convertSampleType(s, { channels: 1 });
    expect(channelCount(out)).toBe(1);
    for (let i = 0; i < out.channels[0].length; i++) {
      expect(out.channels[0][i]).toBeCloseTo(s.channels[0][i] * 0.5 + s.channels[1][i] * 0.5, 5);
    }
  });

  it("honours custom Left/Right mix", () => {
    const s = stereo();
    const out = convertSampleType(s, { channels: 1, leftMix: 1, rightMix: 0 });
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBeLessThan(1e-6); // left only
  });

  it("mono → stereo duplicates the channel", () => {
    const m = mono();
    const out = convertSampleType(m, { channels: 2 });
    expect(channelCount(out)).toBe(2);
    expect(maxAbsDiff(out.channels[0], m.channels[0])).toBe(0);
    expect(maxAbsDiff(out.channels[1], m.channels[0])).toBe(0);
  });

  it("keeps the channel count when target equals source", () => {
    expect(channelCount(convertSampleType(mono(), { channels: 1 }))).toBe(1);
    expect(channelCount(convertSampleType(stereo(), { channels: 2 }))).toBe(2);
  });
});

describe("convertSampleType — bit depth", () => {
  it("snaps every sample onto the 2^(N−1) grid", () => {
    for (const bits of [8, 12, 16]) {
      const out = convertSampleType(mono(), { bitDepth: bits });
      const step = 1 / Math.pow(2, bits - 1);
      expect(gridError(out.channels[0], step)).toBeLessThan(1e-4);
    }
  });

  it("quantization error never exceeds half a step", () => {
    const m = mono();
    const bits = 8;
    const step = 1 / Math.pow(2, bits - 1);
    const out = convertSampleType(m, { bitDepth: bits });
    expect(maxAbsDiff(out.channels[0], m.channels[0])).toBeLessThanOrEqual(step / 2 + 1e-7);
  });

  it("bitDepth ≥ 32 (or unset) leaves the resolution untouched", () => {
    const m = mono();
    expect(maxAbsDiff(convertSampleType(m, { bitDepth: 32 }).channels[0], m.channels[0])).toBe(0);
    expect(maxAbsDiff(convertSampleType(m, {}).channels[0], m.channels[0])).toBe(0);
  });
});

describe("convertSampleType — dither", () => {
  const step = 1 / Math.pow(2, 7); // 8-bit

  it("keeps samples on the grid but differs from plain truncation", () => {
    const m = mono();
    const dithered = convertSampleType(m, { bitDepth: 8, dither: true, seed: 5 });
    const plain = convertSampleType(m, { bitDepth: 8, dither: false });
    expect(gridError(dithered.channels[0], step)).toBeLessThan(1e-4); // still 8-bit
    expect(maxAbsDiff(dithered.channels[0], plain.channels[0])).toBeGreaterThan(0); // decorrelated
  });

  it("is deterministic for a fixed seed and varies with the seed", () => {
    const m = mono();
    const a = convertSampleType(m, { bitDepth: 8, dither: true, seed: 5 });
    const b = convertSampleType(m, { bitDepth: 8, dither: true, seed: 5 });
    const c = convertSampleType(m, { bitDepth: 8, dither: true, seed: 6 });
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
    expect(maxAbsDiff(a.channels[0], c.channels[0])).toBeGreaterThan(0);
  });
});

describe("convertSampleType — combined & robustness", () => {
  it("applies channels and bit depth together", () => {
    const out = convertSampleType(stereo(), { channels: 1, bitDepth: 12 });
    expect(channelCount(out)).toBe(1);
    expect(gridError(out.channels[0], 1 / Math.pow(2, 11))).toBeLessThan(1e-4);
  });

  it("does not mutate the input", () => {
    const s = stereo();
    const snapshot = Float32Array.from(s.channels[0]);
    convertSampleType(s, { channels: 1, bitDepth: 8, dither: true });
    expect(maxAbsDiff(s.channels[0], snapshot)).toBe(0);
  });

  it("is deterministic", () => {
    const m = mono();
    const a = convertSampleType(m, { channels: 2, bitDepth: 16 });
    const b = convertSampleType(m, { channels: 2, bitDepth: 16 });
    expect(maxAbsDiff(a.channels[1], b.channels[1])).toBe(0);
  });

  it("handles an empty buffer", () => {
    const out = convertSampleType(createAudioData(2, 0, SR), { channels: 1, bitDepth: 8 });
    expect(channelCount(out)).toBe(1);
    expect(frameCount(out)).toBe(0);
  });
});
