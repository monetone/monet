// ─────────────────────────────────────────────────────────────
// engine/analysis/amplitude-stats.test — Audition-style Amplitude Statistics
// ─────────────────────────────────────────────────────────────
// Pins the report against signals with known amplitude: a half-scale sine reads
// −6 dB peak / −9 dB RMS, a DC signal surfaces its offset, a clamped signal
// counts clipped samples, a fade shows a wide dynamic range, and silence floors.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { DB_FLOOR } from "../audio/db";
import type { AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { amplitudeStatistics } from "./amplitude-stats";

const SR = 44100;

describe("amplitudeStatistics — known signals", () => {
  it("reads a half-scale sine as −6 dB peak / −9 dB RMS", () => {
    const s = amplitudeStatistics(sine(1000, 1, { sampleRate: SR, amplitude: 0.5 }));
    const c = s.channels[0];
    expect(c.peakDb).toBeCloseTo(-6.02, 1);
    expect(c.totalRmsDb).toBeCloseTo(-9.03, 1);
    expect(c.minSample).toBeCloseTo(-0.5, 2);
    expect(c.maxSample).toBeCloseTo(0.5, 2);
    expect(Math.abs(c.dcOffset)).toBeLessThan(1e-3);
    expect(c.possiblyClippedSamples).toBe(0);
    expect(c.dynamicRangeDb).toBeLessThan(0.1); // steady tone → no spread
    expect(s.windowMs).toBe(50);
  });

  it("surfaces a DC offset", () => {
    const dc = createAudioData(1, SR, SR);
    dc.channels[0].fill(0.4);
    const c = amplitudeStatistics(dc).channels[0];
    expect(c.dcOffset).toBeCloseTo(0.4, 4);
    expect(c.dcOffsetDb).toBeCloseTo(-7.96, 1);
    expect(c.peakDb).toBeCloseTo(-7.96, 1);
    expect(c.dynamicRangeDb).toBeLessThan(0.1);
  });

  it("counts possibly-clipped samples in a clamped signal", () => {
    const clip = sine(500, 0.2, { sampleRate: SR, amplitude: 1.5 });
    for (let i = 0; i < clip.channels[0].length; i++) clip.channels[0][i] = Math.max(-1, Math.min(1, clip.channels[0][i]));
    const c = amplitudeStatistics(clip).channels[0];
    expect(c.peakDb).toBeCloseTo(0, 1);
    expect(c.possiblyClippedSamples).toBeGreaterThan(1000);
  });

  it("reports a wide dynamic range for a loud-then-quiet signal", () => {
    const fade = createAudioData(1, SR, SR);
    for (let i = 0; i < SR; i++) {
      const g = i < SR / 2 ? 0.8 : 0.02;
      fade.channels[0][i] = g * Math.sin((2 * Math.PI * 440 * i) / SR);
    }
    const c = amplitudeStatistics(fade).channels[0];
    expect(c.maxRmsDb).toBeGreaterThan(c.minRmsDb);
    expect(c.dynamicRangeDb).toBeGreaterThan(20);
  });

  it("captures asymmetric sample extremes", () => {
    const d = createAudioData(1, 1000, SR);
    for (let i = 0; i < 1000; i++) d.channels[0][i] = i % 2 === 0 ? 0.6 : -0.3;
    const c = amplitudeStatistics(d).channels[0];
    expect(c.maxSample).toBeCloseTo(0.6, 4);
    expect(c.minSample).toBeCloseTo(-0.3, 4);
    expect(c.peak).toBeCloseTo(0.6, 4);
  });

  it("floors on silence", () => {
    const c = amplitudeStatistics(createAudioData(1, 1000, SR)).channels[0];
    expect(c.peakDb).toBe(DB_FLOOR);
    expect(c.totalRmsDb).toBe(DB_FLOOR);
    expect(c.possiblyClippedSamples).toBe(0);
    expect(c.dynamicRangeDb).toBe(0);
  });
});

describe("amplitudeStatistics — channels & options", () => {
  it("reports per-channel plus an aggregate over channels", () => {
    const left = sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const right = new Float32Array(left.length).fill(1); // fully clipped right channel
    const d: AudioData = { sampleRate: SR, channels: [Float32Array.from(left), right] };
    const s = amplitudeStatistics(d);
    expect(s.channels).toHaveLength(2);
    expect(s.overall.peak).toBeCloseTo(1, 4); // loudest of the two
    expect(s.overall.possiblyClippedSamples).toBe(s.channels[0].possiblyClippedSamples + s.channels[1].possiblyClippedSamples);
    expect(s.channels[1].possiblyClippedSamples).toBe(right.length);
  });

  it("honours a custom clipping ceiling", () => {
    const d = createAudioData(1, 1000, SR);
    d.channels[0].fill(0.9);
    expect(amplitudeStatistics(d, { ceiling: 0.95 }).channels[0].possiblyClippedSamples).toBe(0);
    expect(amplitudeStatistics(d, { ceiling: 0.85 }).channels[0].possiblyClippedSamples).toBe(1000);
  });

  it("honours a custom RMS window", () => {
    expect(amplitudeStatistics(createAudioData(1, 100, SR), { windowMs: 20 }).windowMs).toBe(20);
  });

  it("is deterministic", () => {
    const t = sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5 });
    expect(amplitudeStatistics(t)).toEqual(amplitudeStatistics(t));
  });

  it("handles an empty buffer", () => {
    const c = amplitudeStatistics(createAudioData(1, 0, SR)).channels[0];
    expect(c.minSample).toBe(0);
    expect(c.maxSample).toBe(0);
    expect(c.peakDb).toBe(DB_FLOOR);
    expect(c.possiblyClippedSamples).toBe(0);
  });
});
