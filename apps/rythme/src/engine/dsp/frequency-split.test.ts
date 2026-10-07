// ─────────────────────────────────────────────────────────────
// engine/dsp/frequency-split.test — Audition-style Frequency Band Splitter
// ─────────────────────────────────────────────────────────────
// Pins the two defining properties: N crossovers yield N+1 bands that sum
// *exactly* back to the input (subtractive crossover), and each band is well
// isolated (a tone lands almost entirely in its own band thanks to the
// zero-phase low-pass).

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { whiteNoise } from "../generate/noise";
import { sine } from "../generate/tone";
import { frequencyBandLabels, frequencyBandSplit } from "./frequency-split";

const SR = 44100;

const noise = (seed = 3, seconds = 0.25) => whiteNoise(seconds, { sampleRate: SR, amplitude: 0.5, seed, channels: 1 });

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, ch.length));
}

/** Max |Σbands − input| per channel — the reconstruction error. */
function reconstructionError(input: AudioData, bands: AudioData[]): number {
  let maxErr = 0;
  for (let c = 0; c < input.channels.length; c++) {
    const x = input.channels[c];
    for (let i = 0; i < x.length; i++) {
      let sum = 0;
      for (const b of bands) sum += b.channels[c][i];
      maxErr = Math.max(maxErr, Math.abs(sum - x[i]));
    }
  }
  return maxErr;
}

describe("frequencyBandSplit — structure & reconstruction", () => {
  it("makes N+1 bands for N crossovers", () => {
    expect(frequencyBandSplit(noise(), { crossovers: [1000] })).toHaveLength(2);
    expect(frequencyBandSplit(noise(), { crossovers: [800, 3200] })).toHaveLength(3);
    expect(frequencyBandSplit(noise(), { crossovers: [120, 1000, 6000] })).toHaveLength(4);
  });

  it("bands sum exactly back to the input", () => {
    const x = noise();
    const bands = frequencyBandSplit(x, { crossovers: [800, 3200] });
    expect(reconstructionError(x, bands)).toBeLessThan(1e-5);
  });

  it("reconstructs a stereo signal too", () => {
    const l = noise(1).channels[0];
    const r = noise(2).channels[0];
    const x: AudioData = { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
    const bands = frequencyBandSplit(x, { crossovers: [500, 4000] });
    expect(bands).toHaveLength(3);
    for (const b of bands) expect(channelCount(b)).toBe(2);
    expect(reconstructionError(x, bands)).toBeLessThan(1e-5);
  });

  it("preserves frame & channel count in every band", () => {
    const x = noise();
    for (const b of frequencyBandSplit(x, { crossovers: [800, 3200] })) {
      expect(frameCount(b)).toBe(frameCount(x));
      expect(channelCount(b)).toBe(1);
    }
  });
});

describe("frequencyBandSplit — isolation", () => {
  const split = (freq: number) => frequencyBandSplit(sine(freq, 0.25, { sampleRate: SR, amplitude: 0.5 }), { crossovers: [800, 3200] });
  const ref = rms(sine(1000, 0.25, { sampleRate: SR, amplitude: 0.5 }).channels[0]);

  it("a low tone lands in the bottom band", () => {
    const bands = split(200).map((b) => rms(b.channels[0]));
    expect(bands[0]).toBeGreaterThan(ref * 0.7);
    expect(bands[1]).toBeLessThan(ref * 0.2);
    expect(bands[2]).toBeLessThan(ref * 0.2);
  });

  it("a mid tone lands in the middle band", () => {
    const bands = split(1500).map((b) => rms(b.channels[0]));
    expect(bands[1]).toBeGreaterThan(ref * 0.7);
    expect(bands[0]).toBeLessThan(ref * 0.2);
    expect(bands[2]).toBeLessThan(ref * 0.2);
  });

  it("a high tone lands in the top band", () => {
    const bands = split(8000).map((b) => rms(b.channels[0]));
    expect(bands[2]).toBeGreaterThan(ref * 0.7);
    expect(bands[0]).toBeLessThan(ref * 0.2);
    expect(bands[1]).toBeLessThan(ref * 0.2);
  });
});

describe("frequencyBandSplit — edges & robustness", () => {
  it("returns a single copy when there is no usable crossover", () => {
    const x = noise();
    const out = frequencyBandSplit(x, { crossovers: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBe(x); // a copy, not the same reference
    let maxErr = 0;
    for (let i = 0; i < x.channels[0].length; i++) maxErr = Math.max(maxErr, Math.abs(out[0].channels[0][i] - x.channels[0][i]));
    expect(maxErr).toBe(0);
  });

  it("sorts, de-duplicates and drops out-of-range crossovers", () => {
    const x = noise();
    // 3200 dup, 800 unordered, 99999 (> Nyquist), 0 (invalid) → effective {800, 3200} → 3 bands
    expect(frequencyBandSplit(x, { crossovers: [3200, 800, 3200, 99999, 0] })).toHaveLength(3);
  });

  it("clamps to at most 8 bands (7 crossovers)", () => {
    const many = [50, 120, 300, 800, 2000, 5000, 9000, 12000, 15000, 18000]; // 10 crossovers
    expect(frequencyBandSplit(noise(), { crossovers: many })).toHaveLength(8);
  });

  it("does not mutate the input and is deterministic", () => {
    const x = noise();
    const snapshot = Float32Array.from(x.channels[0]);
    const a = frequencyBandSplit(x, { crossovers: [800, 3200] });
    const b = frequencyBandSplit(x, { crossovers: [800, 3200] });
    let mut = 0;
    for (let i = 0; i < x.channels[0].length; i++) mut = Math.max(mut, Math.abs(x.channels[0][i] - snapshot[i]));
    expect(mut).toBe(0);
    let diff = 0;
    for (let bi = 0; bi < a.length; bi++) for (let i = 0; i < a[bi].channels[0].length; i++) diff = Math.max(diff, Math.abs(a[bi].channels[0][i] - b[bi].channels[0][i]));
    expect(diff).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = frequencyBandSplit(empty, { crossovers: [800, 3200] });
    expect(out).toHaveLength(1);
    expect(frameCount(out[0])).toBe(0);
  });
});

describe("frequencyBandLabels", () => {
  it("describes each band's range", () => {
    expect(frequencyBandLabels([800, 3200], SR)).toEqual(["0–800 Hz", "800 Hz–3.2 kHz", "3.2 kHz+"]);
  });

  it("labels the full band when there is no crossover", () => {
    expect(frequencyBandLabels([], SR)).toEqual(["Full Band"]);
  });
});
