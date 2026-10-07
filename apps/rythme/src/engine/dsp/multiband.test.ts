// ─────────────────────────────────────────────────────────────
// engine/dsp/multiband.test — Audition-style Multiband Compressor
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { dbToGain, gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { peakAmplitude, rmsAmplitude } from "./normalize";
import { multibandCompress } from "./multiband";

const SR = 44100;

/** Sample-by-sample sum of two same-length channel-0 tones into a buffer. */
function mix(a: AudioData, b: AudioData): AudioData {
  return { sampleRate: SR, channels: [a.channels[0].map((v, i) => v + b.channels[0][i])] };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("multibandCompress", () => {
  it("reconstructs a flat magnitude when no band is compressed (Linkwitz-Riley sum)", () => {
    // Probe several frequencies away from the crossovers; each should pass at ~unity.
    for (const freq of [200, 1500, 9000]) {
      const tone = sine(freq, 0.4, { sampleRate: SR, amplitude: 0.5 });
      const out = multibandCompress(tone, {});
      expect(Math.abs(gainToDb(rmsAmplitude(out)) - gainToDb(rmsAmplitude(tone)))).toBeLessThan(1);
    }
  });

  it("compresses only the low band, leaving a high tone intact", () => {
    // A tone in band 0 (60 Hz, < 120) vs a tone in the top band (8 kHz, > 5000).
    const lowOnly = sine(60, 0.5, { sampleRate: SR, amplitude: 0.5 });
    const highOnly = sine(8000, 0.5, { sampleRate: SR, amplitude: 0.5 });
    const opts = { bands: [{ thresholdDb: -40, ratio: 20, makeupDb: 0 }] }; // crush band 0 only
    const lowOut = multibandCompress(lowOnly, opts);
    const highOut = multibandCompress(highOnly, opts);
    const dropDb = (a: AudioData, b: AudioData) => gainToDb(rmsAmplitude(a)) - gainToDb(rmsAmplitude(b));
    expect(dropDb(lowOnly, lowOut)).toBeGreaterThanOrEqual(10); // low tone heavily reduced
    expect(Math.abs(dropDb(highOnly, highOut))).toBeLessThan(1.5); // high tone barely touched
  });

  it("sorts and clamps crossover frequencies (unsorted input still works)", () => {
    const tone = mix(sine(120, 0.2, { sampleRate: SR, amplitude: 0.4 }), sine(3000, 0.2, { sampleRate: SR, amplitude: 0.3 }));
    const sorted = multibandCompress(tone, { crossover: [120, 700, 5000] });
    const shuffled = multibandCompress(tone, { crossover: [5000, 120, 999999, 700] }); // out-of-range dropped, rest sorted
    expect(maxAbsDiff(sorted.channels[0], shuffled.channels[0])).toBeLessThan(1e-6);
  });

  it("applies the optional global limiter to hold a ceiling", () => {
    const loud = sine(1000, 0.3, { sampleRate: SR, amplitude: 0.9 });
    const out = multibandCompress(loud, {
      bands: [{}, { makeupDb: 18 }, {}, {}], // boost the band containing 1 kHz
      limiter: { ceilingDb: -0.3, inputBoostDb: 0 },
    });
    expect(peakAmplitude(out)).toBeLessThanOrEqual(dbToGain(-0.3) + 1e-4);
  });

  it("preserves channel + frame count and processes stereo", () => {
    const tone = sine(1000, 0.3, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = multibandCompress(tone, { bands: [{ thresholdDb: -20, ratio: 4 }] });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(tone));
  });

  it("is deterministic", () => {
    const tone = mix(sine(80, 0.2, { sampleRate: SR, amplitude: 0.5 }), sine(4000, 0.2, { sampleRate: SR, amplitude: 0.3 }));
    const params = { bands: [{ thresholdDb: -24, ratio: 4, makeupDb: 2 }] };
    const a = multibandCompress(tone, params);
    const b = multibandCompress(tone, params);
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const tone = mix(sine(80, 0.2, { sampleRate: SR, amplitude: 0.5 }), sine(4000, 0.2, { sampleRate: SR, amplitude: 0.3 }));
    const copy = Array.from(tone.channels[0]);
    multibandCompress(tone, { bands: [{ thresholdDb: -30, ratio: 8 }], limiter: { ceilingDb: -1 } });
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = multibandCompress(createAudioData(2, 0, SR), { bands: [{ ratio: 4 }] });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
