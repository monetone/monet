// ─────────────────────────────────────────────────────────────
// engine/dsp/phaser.test — Audition-style Graphic Phase Shifter
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { spectrum } from "../analysis/spectrum";
import { rmsAmplitude } from "./normalize";
import { phaser } from "./phaser";

const SR = 44100;

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentMeanAbsDiff(a: AudioData, b: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * a.sampleRate));
  const end = Math.min(frameCount(a), frameCount(b), Math.round(endSeconds * a.sampleRate));
  let sum = 0;
  let count = 0;
  const channels = Math.min(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c++) {
    for (let i = start; i < end; i++) {
      sum += Math.abs(a.channels[c][i] - b.channels[c][i]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function maxAudioDiff(a: AudioData, b: AudioData): number {
  let m = 0;
  const channels = Math.min(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c++) m = Math.max(m, maxAbsDiff(a.channels[c], b.channels[c]));
  return m;
}

function gatedTone(): AudioData {
  const n = SR;
  const out = createAudioData(1, n, SR);
  for (let i = 0; i < n; i++) {
    const time = i / SR;
    if ((time >= 0.1 && time < 0.2) || (time >= 0.7 && time < 0.8)) {
      out.channels[0][i] = 0.4 * Math.sin((2 * Math.PI * 700 * i) / SR);
    }
  }
  return out;
}

function impulseAt(seconds: number, totalSeconds = 0.8): AudioData {
  const out = createAudioData(1, Math.round(totalSeconds * SR), SR);
  out.channels[0][Math.round(seconds * SR)] = 1;
  return out;
}

describe("phaser", () => {
  it("mix=0 is an exact pass-through", () => {
    const tone = sine(440, 0.2, { sampleRate: SR, amplitude: 0.6 });
    const out = phaser(tone, { mix: 0, rateHz: 1, feedback: 0.4 });
    expect(Array.from(out.channels[0])).toEqual(Array.from(tone.channels[0]));
  });

  it("automates mix per sample without changing the phaser state", () => {
    const tone = sine(700, 1, { sampleRate: SR, amplitude: 0.4 });
    const opts = { mix: 0, rateHz: 0.8, feedback: 0.3, stages: 4, depth: 1 };
    const out = phaser(tone, {
      ...opts,
      automation: {
        mix: (time, fallback) => (time < 0.5 ? fallback : 1),
      },
    });
    const dry = phaser(tone, opts);
    const wet = phaser(tone, { ...opts, mix: 1 });

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("applies sweep parameter automation with the same output as equivalent static settings", () => {
    const tone = sine(700, 1, { sampleRate: SR, amplitude: 0.4 });
    const low = { mix: 1, feedback: 0.2, rateHz: 0.1, depth: 0.2, baseFreqHz: 120, rangeOctaves: 1, stages: 4 };
    const high = { ...low, rateHz: 2.5, depth: 1, baseFreqHz: 900, rangeOctaves: 5 };
    const out = phaser(tone, {
      ...low,
      automation: {
        rateHz: () => high.rateHz,
        depth: () => high.depth,
        baseFreqHz: () => high.baseFreqHz,
        rangeOctaves: () => high.rangeOctaves,
      },
    });
    const expected = phaser(tone, high);

    expect(maxAudioDiff(out, expected)).toBe(0);
  });

  it("switches sweep depth and frequency automation between separated tone bursts", () => {
    const tone = gatedTone();
    const low = { mix: 1, feedback: 0, rateHz: 0.5, depth: 0.1, baseFreqHz: 120, rangeOctaves: 1, stages: 4 };
    const high = { ...low, depth: 1, baseFreqHz: 900, rangeOctaves: 5 };
    const out = phaser(tone, {
      ...low,
      automation: {
        depth: (time, fallback) => (time < 0.5 ? fallback : high.depth),
        baseFreqHz: (time, fallback) => (time < 0.5 ? fallback : high.baseFreqHz),
        rangeOctaves: (time, fallback) => (time < 0.5 ? fallback : high.rangeOctaves),
      },
    });
    const lowOut = phaser(tone, low);
    const highOut = phaser(tone, high);

    expect(segmentMeanAbsDiff(out, lowOut, 0.1, 0.2)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, highOut, 0.7, 0.8)).toBeLessThan(1e-4);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.7, 0.8)).toBeGreaterThan(0.01);
  });

  it("automates stage count in the allpass cascade", () => {
    const input = impulseAt(0.55);
    const low = { mix: 1, feedback: 0, rateHz: 0, stages: 2, depth: 0, baseFreqHz: 700, rangeOctaves: 0 };
    const high = { ...low, stages: 8 };
    const out = phaser(input, {
      ...low,
      automation: {
        stages: (time, fallback) => (time < 0.5 ? fallback : high.stages),
      },
    });
    const lowOut = phaser(input, low);
    const highOut = phaser(input, high);

    expect(segmentMeanAbsDiff(out, highOut, 0.55, 0.75)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.55, 0.75)).toBeGreaterThan(5e-4);
  });

  it("pure wet (mix=1, no feedback) preserves RMS — allpass has unity magnitude", () => {
    const tone = sine(800, 0.4, { sampleRate: SR, amplitude: 0.5 });
    const out = phaser(tone, { mix: 1, feedback: 0, rateHz: 0.5, stages: 4 });
    expect(rmsAmplitude(out)).toBeCloseTo(rmsAmplitude(tone), 1); // within ~0.05
  });

  it("a static phaser carves a deep spectral notch (and is not uniform attenuation)", () => {
    const noise = whiteNoise(0.5, { sampleRate: SR, amplitude: 0.3, seed: 7 });
    const out = phaser(noise, { rateHz: 0, mix: 0.5, feedback: 0, stages: 4, depth: 1 });
    const inSpec = spectrum(noise, { fftSize: 2048 });
    const outSpec = spectrum(out, { fftSize: 2048 });
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    for (let k = 1; k < inSpec.db.length - 1; k++) {
      const diff = outSpec.db[k] - inSpec.db[k];
      if (diff < minDiff) minDiff = diff;
      if (diff > maxDiff) maxDiff = diff;
    }
    expect(minDiff).toBeLessThan(-6); // a real notch exists
    expect(maxDiff).toBeGreaterThan(-1); // some bins are kept/boosted — not a flat cut
  });

  it("changing the LFO rate changes the output (and both differ from the dry input)", () => {
    const noise = whiteNoise(0.3, { sampleRate: SR, amplitude: 0.3, seed: 3 });
    const still = phaser(noise, { rateHz: 0, mix: 0.5 });
    const swept = phaser(noise, { rateHz: 3, mix: 0.5 });
    expect(maxAbsDiff(still.channels[0], swept.channels[0])).toBeGreaterThan(1e-3);
    expect(maxAbsDiff(noise.channels[0], swept.channels[0])).toBeGreaterThan(1e-3);
  });

  it("preserves channel + frame count and processes stereo", () => {
    const tone = sine(440, 0.3, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = phaser(tone, { rateHz: 1 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(tone));
  });

  it("is deterministic", () => {
    const noise = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.3, seed: 5 });
    const a = phaser(noise, { rateHz: 2, feedback: 0.5 });
    const b = phaser(noise, { rateHz: 2, feedback: 0.5 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input and stays finite even with high feedback", () => {
    const noise = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 1 });
    const copy = Array.from(noise.channels[0]);
    const out = phaser(noise, { rateHz: 1, feedback: 0.95, mix: 0.7 });
    expect(Array.from(noise.channels[0])).toEqual(copy);
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });

  it("handles an empty buffer", () => {
    const out = phaser(createAudioData(2, 0, SR), { rateHz: 1 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
