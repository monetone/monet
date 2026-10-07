// ─────────────────────────────────────────────────────────────
// engine/dsp/limiter.test — Audition-style Hard Limiter
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, fromChannels } from "../audio/buffer";
import { dbToGain, gainToDb } from "../audio/db";
import { channelCount, frameCount } from "../audio/types";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { peakAmplitude, rmsAmplitude } from "./normalize";
import { measureTruePeak } from "../analysis/loudness";
import { hardLimiter, truePeakLimiter } from "./limiter";

const SR = 44100;

/** RMS of a single channel over [start, end). */
function rmsRange(ch: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

function limiterImpulseOnsets() {
  const ch = new Float32Array(SR);
  for (let i = 0; i < ch.length; i++) ch[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR);
  ch[Math.round(0.25 * SR)] = 1;
  ch[Math.round(0.75 * SR)] = 1;
  return fromChannels([ch], SR);
}

describe("hardLimiter", () => {
  it("never lets the output exceed the ceiling (loud sine + big boost)", () => {
    const loud = sine(440, 0.2, { sampleRate: SR, amplitude: 0.95 });
    const out = hardLimiter(loud, { ceilingDb: -0.3, inputBoostDb: 18 });
    expect(peakAmplitude(out)).toBeLessThanOrEqual(dbToGain(-0.3) + 1e-6);
  });

  it("holds the ceiling for white noise and a lone impulse", () => {
    const noise = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.8, seed: 9 });
    expect(peakAmplitude(hardLimiter(noise, { ceilingDb: -0.1, inputBoostDb: 12 }))).toBeLessThanOrEqual(dbToGain(-0.1) + 1e-6);
    // a quiet bed with a single full-scale spike
    const spike = new Float32Array(SR * 0.1).fill(0.05);
    spike[Math.floor(spike.length / 2)] = 1.0;
    const out = hardLimiter(fromChannels([spike], SR), { ceilingDb: -0.5, inputBoostDb: 6 });
    expect(peakAmplitude(out)).toBeLessThanOrEqual(dbToGain(-0.5) + 1e-6);
  });

  it("input boost raises loudness and pushes the peak up to the ceiling", () => {
    const quiet = sine(440, 0.3, { sampleRate: SR, amplitude: 0.1 });
    const out = hardLimiter(quiet, { ceilingDb: -0.3, inputBoostDb: 24 });
    expect(gainToDb(peakAmplitude(out))).toBeCloseTo(-0.3, 1); // reaches the ceiling
    expect(rmsAmplitude(out)).toBeGreaterThan(rmsAmplitude(quiet) * 4); // much louder
  });

  it("applies input boost automation during limiting", () => {
    const quiet = sine(440, 1, { sampleRate: SR, amplitude: 0.08 });
    const out = hardLimiter(quiet, {
      ceilingDb: -0.3,
      inputBoostDb: 0,
      lookAheadMs: 1,
      releaseMs: 20,
      automation: { inputBoostDb: (time) => (time < 0.5 ? 0 : 20) },
    });

    const first = rmsRange(out.channels[0], Math.round(0.15 * SR), Math.round(0.45 * SR));
    const second = rmsRange(out.channels[0], Math.round(0.75 * SR), Math.round(0.95 * SR));

    expect(first).toBeCloseTo(rmsAmplitude(quiet), 2);
    expect(second).toBeGreaterThan(first * 7);
    expect(peakAmplitude(out)).toBeLessThanOrEqual(dbToGain(-0.3) + 1e-6);
  });

  it("leaves a signal already below the ceiling unchanged (no boost)", () => {
    const tame = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const out = hardLimiter(tame, { ceilingDb: -0.3, inputBoostDb: 0 });
    let maxErr = 0;
    for (let i = 0; i < frameCount(tame); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[0][i] - tame.channels[0][i]));
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("look-ahead reduces gain before a loud onset", () => {
    const half = Math.floor(SR * 0.15);
    const ch = new Float32Array(half * 2);
    for (let i = 0; i < half; i++) ch[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR); // quiet bed
    for (let i = half; i < ch.length; i++) ch[i] = 0.95 * Math.sin((2 * Math.PI * 440 * i) / SR); // loud
    const sig = fromChannels([ch], SR);
    const withLA = hardLimiter(sig, { ceilingDb: -0.3, inputBoostDb: 6, lookAheadMs: 20 });
    const noLA = hardLimiter(sig, { ceilingDb: -0.3, inputBoostDb: 6, lookAheadMs: 0 });
    const L = Math.round((20 / 1000) * SR);
    // The window just before the onset is ducked with look-ahead, not without.
    const a = rmsRange(withLA.channels[0], half - L, half);
    const b = rmsRange(noLA.channels[0], half - L, half);
    expect(a).toBeLessThan(b * 0.97);
  });

  it("matches static look-ahead when look-ahead automation is constant", () => {
    const sig = limiterImpulseOnsets();
    const staticOut = hardLimiter(sig, { ceilingDb: -0.3, inputBoostDb: 6, lookAheadMs: 20, releaseMs: 20 });
    const autoOut = hardLimiter(sig, {
      ceilingDb: -0.3,
      inputBoostDb: 6,
      lookAheadMs: 0,
      releaseMs: 20,
      automation: { lookAheadMs: () => 20 },
    });

    let maxErr = 0;
    for (let i = 0; i < frameCount(staticOut); i++) maxErr = Math.max(maxErr, Math.abs(staticOut.channels[0][i] - autoOut.channels[0][i]));

    expect(maxErr).toBeLessThan(1e-6);
  });

  it("automates look-ahead time before later loud onsets", () => {
    const sig = limiterImpulseOnsets();
    const out = hardLimiter(sig, {
      ceilingDb: -0.3,
      inputBoostDb: 6,
      lookAheadMs: 0,
      releaseMs: 20,
      automation: { lookAheadMs: (time) => (time < 0.5 ? 0 : 20) },
    });

    const firstPre = rmsRange(out.channels[0], Math.round(0.23 * SR), Math.round(0.25 * SR));
    const secondPre = rmsRange(out.channels[0], Math.round(0.73 * SR), Math.round(0.75 * SR));

    expect(firstPre).toBeGreaterThan(secondPre * 1.15);
    expect(peakAmplitude(out)).toBeLessThanOrEqual(dbToGain(-0.3) + 1e-6);
  });

  it("uses stereo-linked detection (a loud left channel ducks the right)", () => {
    const n = Math.floor(SR * 0.2);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      left[i] = 0.9 * Math.sin((2 * Math.PI * 300 * i) / SR);
      right[i] = 0.2 * Math.sin((2 * Math.PI * 500 * i) / SR);
    }
    const out = hardLimiter({ sampleRate: SR, channels: [left, right] }, { ceilingDb: -0.3, inputBoostDb: 12 });
    // The right channel alone would not need limiting, but the linked detector ducks it.
    expect(rmsAmplitude({ sampleRate: SR, channels: [out.channels[1]] })).toBeLessThan(rmsAmplitude({ sampleRate: SR, channels: [right] }) * dbToGain(12) * 0.95);
    expect(peakAmplitude(out)).toBeLessThanOrEqual(dbToGain(-0.3) + 1e-6);
  });

  it("preserves channel + frame count and is deterministic", () => {
    const sig = sine(440, 0.2, { sampleRate: SR, amplitude: 0.9, channels: 2 });
    const a = hardLimiter(sig, { inputBoostDb: 9 });
    const b = hardLimiter(sig, { inputBoostDb: 9 });
    expect(channelCount(a)).toBe(2);
    expect(frameCount(a)).toBe(frameCount(sig));
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const sig = sine(440, 0.1, { sampleRate: SR, amplitude: 0.95 });
    const copy = Array.from(sig.channels[0]);
    hardLimiter(sig, { inputBoostDb: 12 });
    expect(Array.from(sig.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = hardLimiter(createAudioData(2, 0, SR), { inputBoostDb: 6 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});

describe("truePeakLimiter", () => {
  // An fs/4 tone at 45° phase: samples sit at ±0.707·A so the SAMPLE peak is ~3 dB
  // below the true (inter-sample) peak A — the canonical case a sample-peak meter
  // (and limiter) misses.
  const ispTone = (amp: number, dur = 0.3) =>
    sine(SR / 4, dur, { sampleRate: SR, amplitude: amp, phase: Math.PI / 4, channels: 2 });

  it("holds the INTER-SAMPLE peak under the ceiling where the hard limiter cannot", () => {
    const tone = ispTone(0.9);
    const ceilingDb = -1;
    const tp = truePeakLimiter(tone, { ceilingDb, inputBoostDb: 6 });
    const hl = hardLimiter(tone, { ceilingDb, inputBoostDb: 6 }); // caps the SAMPLE peak only
    expect(measureTruePeak(tp).dBTP).toBeLessThanOrEqual(ceilingDb + 0.3);
    // the hard limiter pins the sample peak at the ceiling …
    expect(peakAmplitude(hl)).toBeLessThanOrEqual(dbToGain(ceilingDb) + 1e-6);
    // … yet leaves the reconstructed true peak well above it (≥ 1 dB over).
    expect(measureTruePeak(hl).dBTP).toBeGreaterThan(ceilingDb + 1);
  });

  it("reaches but does not exceed the true-peak ceiling under heavy boost", () => {
    const tp = truePeakLimiter(ispTone(0.5), { ceilingDb: -1, inputBoostDb: 24 });
    const db = measureTruePeak(tp).dBTP;
    expect(db).toBeLessThanOrEqual(-1 + 0.3);
    expect(db).toBeGreaterThan(-3); // actually driven up to the ceiling, not over-ducked
  });

  it("input boost raises loudness while the true peak stays capped", () => {
    const quiet = sine(440, 0.3, { sampleRate: SR, amplitude: 0.1, channels: 2 });
    const out = truePeakLimiter(quiet, { ceilingDb: -1, inputBoostDb: 24 });
    expect(rmsAmplitude(out)).toBeGreaterThan(rmsAmplitude(quiet) * 4);
    expect(measureTruePeak(out).dBTP).toBeLessThanOrEqual(-1 + 0.3);
  });

  it("leaves a signal already below the ceiling unchanged (no boost)", () => {
    const tame = sine(300, 0.2, { sampleRate: SR, amplitude: 0.3, channels: 2 });
    const out = truePeakLimiter(tame, { ceilingDb: -1, inputBoostDb: 0 });
    let maxErr = 0;
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < frameCount(tame); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[c][i] - tame.channels[c][i]));
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("uses stereo-linked detection and caps the linked true peak", () => {
    const n = Math.floor(SR * 0.2);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      left[i] = 0.9 * Math.sin((2 * Math.PI * (SR / 4) * i) / SR + Math.PI / 4); // loud, inter-sample peaking
      right[i] = 0.15 * Math.sin((2 * Math.PI * 500 * i) / SR); // quiet
    }
    const out = truePeakLimiter({ sampleRate: SR, channels: [left, right] }, { ceilingDb: -1, inputBoostDb: 12 });
    // the quiet right channel is ducked by the loud left (linked detector) …
    expect(rmsAmplitude({ sampleRate: SR, channels: [out.channels[1]] })).toBeLessThan(
      rmsAmplitude({ sampleRate: SR, channels: [right] }) * dbToGain(12) * 0.95,
    );
    expect(measureTruePeak(out).dBTP).toBeLessThanOrEqual(-1 + 0.3);
  });

  it("preserves channel + frame count, is deterministic, and does not mutate input", () => {
    const sig = ispTone(0.9, 0.15);
    const copy = Array.from(sig.channels[0]);
    const a = truePeakLimiter(sig, { inputBoostDb: 9 });
    const b = truePeakLimiter(sig, { inputBoostDb: 9 });
    expect(channelCount(a)).toBe(2);
    expect(frameCount(a)).toBe(frameCount(sig));
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
    expect(Array.from(sig.channels[0])).toEqual(copy); // input untouched
  });

  it("handles an empty buffer", () => {
    const out = truePeakLimiter(createAudioData(2, 0, SR), { inputBoostDb: 6 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
