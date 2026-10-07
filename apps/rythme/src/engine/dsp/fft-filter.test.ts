// ─────────────────────────────────────────────────────────────
// engine/dsp/fft-filter.test — Audition-style FFT Filter
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { rmsAmplitude } from "./normalize";
import { fftFilter } from "./fft-filter";

const SR = 44100;

const dropDb = (a: AudioData, b: AudioData) => gainToDb(rmsAmplitude(a)) - gainToDb(rmsAmplitude(b));

describe("fftFilter", () => {
  it("a flat 0 dB curve reconstructs the input (WOLA identity)", () => {
    const tone = sine(440, 0.25, { sampleRate: SR, amplitude: 0.6 });
    const out = fftFilter(tone, { curve: [{ freq: 0, gainDb: 0 }, { freq: 22050, gainDb: 0 }] });
    expect(frameCount(out)).toBe(frameCount(tone));
    let maxErr = 0;
    for (let i = 0; i < frameCount(tone); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[0][i] - tone.channels[0][i]));
    expect(maxErr).toBeLessThan(1e-3);
  });

  it("a low-pass curve cuts highs and keeps lows", () => {
    const lp = [{ freq: 0, gainDb: 0 }, { freq: 2000, gainDb: 0 }, { freq: 4000, gainDb: -60 }, { freq: 22050, gainDb: -60 }];
    const high = sine(6000, 0.3, { sampleRate: SR, amplitude: 0.6 });
    const low = sine(500, 0.3, { sampleRate: SR, amplitude: 0.6 });
    expect(dropDb(high, fftFilter(high, { curve: lp }))).toBeGreaterThanOrEqual(20);
    expect(Math.abs(dropDb(low, fftFilter(low, { curve: lp })))).toBeLessThan(1.5);
  });

  it("a notch curve removes the notch band but keeps neighbours", () => {
    const notch = [
      { freq: 0, gainDb: 0 }, { freq: 900, gainDb: 0 }, { freq: 1000, gainDb: -60 },
      { freq: 1100, gainDb: 0 }, { freq: 22050, gainDb: 0 },
    ];
    const inBand = sine(1000, 0.3, { sampleRate: SR, amplitude: 0.6 });
    const outBand = sine(1600, 0.3, { sampleRate: SR, amplitude: 0.6 });
    expect(dropDb(inBand, fftFilter(inBand, { curve: notch }))).toBeGreaterThanOrEqual(15);
    expect(Math.abs(dropDb(outBand, fftFilter(outBand, { curve: notch })))).toBeLessThan(1.5);
  });

  it("a boost curve raises a tone in the boosted band", () => {
    const boost = [{ freq: 0, gainDb: 0 }, { freq: 3000, gainDb: 12 }, { freq: 6000, gainDb: 0 }];
    const tone = sine(3000, 0.3, { sampleRate: SR, amplitude: 0.3 });
    expect(-dropDb(tone, fftFilter(tone, { curve: boost }))).toBeGreaterThanOrEqual(6);
  });

  it("preserves channel + frame count and processes stereo", () => {
    const tone = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = fftFilter(tone, { curve: [{ freq: 0, gainDb: 0 }, { freq: 1000, gainDb: -12 }, { freq: 22050, gainDb: 0 }] });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(tone));
  });

  it("is deterministic", () => {
    const tone = sine(440, 0.2, { sampleRate: SR, amplitude: 0.6 });
    const curve = [{ freq: 0, gainDb: 0 }, { freq: 3000, gainDb: -18 }, { freq: 22050, gainDb: 0 }];
    const a = fftFilter(tone, { curve });
    const b = fftFilter(tone, { curve });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const tone = sine(440, 0.15, { sampleRate: SR, amplitude: 0.6 });
    const copy = Array.from(tone.channels[0]);
    fftFilter(tone, { curve: [{ freq: 0, gainDb: -6 }, { freq: 22050, gainDb: -6 }] });
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });

  it("throws on a non-power-of-two FFT size", () => {
    const tone = sine(440, 0.05, { sampleRate: SR, amplitude: 0.5 });
    expect(() => fftFilter(tone, { curve: [{ freq: 0, gainDb: 0 }], fftSize: 1000 })).toThrow(/power of two/);
  });

  it("handles empty and shorter-than-FFT buffers without NaN", () => {
    const empty = createAudioData(2, 0, SR);
    expect(frameCount(fftFilter(empty, { curve: [{ freq: 0, gainDb: 0 }] }))).toBe(0);
    const short = sine(440, 0.01, { sampleRate: SR, amplitude: 0.5 }); // < one FFT frame
    const out = fftFilter(short, { curve: [{ freq: 0, gainDb: 0 }, { freq: 22050, gainDb: -6 }] });
    expect(frameCount(out)).toBe(frameCount(short));
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });
});
