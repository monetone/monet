// ─────────────────────────────────────────────────────────────
// engine/generate/tones.test — Audition-style Generate ▸ Tones
// ─────────────────────────────────────────────────────────────
// Pins the modulated-tone generator: a pure tone concentrates its energy at one
// bin, frequency modulation spreads it into sidebands, harmonics add overtones at
// 2f/3f, and the buffer shape / amplitude are respected.

import { describe, expect, it } from "vitest";
import { magnitudes } from "../analysis/fft";
import { frameCount } from "../audio/types";
import { tones } from "./tone";

const SR = 44100;
const FFT = 8192;

function peak(ch: Float32Array): number {
  let p = 0;
  for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
}
/** Fraction of spectral energy in the single loudest bin. */
function peakFraction(ch: Float32Array): number {
  const mags = magnitudes(ch.subarray(0, FFT), FFT);
  let total = 0;
  let mx = 0;
  for (const m of mags) {
    total += m * m;
    mx = Math.max(mx, m);
  }
  return total > 0 ? (mx * mx) / total : 0;
}
function binMag(ch: Float32Array, hz: number): number {
  return magnitudes(ch.subarray(0, FFT), FFT)[Math.round((hz * FFT) / SR)];
}

describe("tones — pure", () => {
  it("concentrates energy at the base frequency and peaks at the amplitude", () => {
    const t = tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8 });
    expect(peak(t.channels[0])).toBeCloseTo(0.8, 1);
    expect(peakFraction(t.channels[0])).toBeGreaterThan(0.7);
  });

  it("matches a plain sine when unmodulated", () => {
    const t = tones(440, 0.05, { sampleRate: SR, amplitude: 0.5 });
    // first sample is sin(0) = 0; quarter-period later it is near +amp.
    expect(t.channels[0][0]).toBeCloseTo(0, 4);
    expect(peak(t.channels[0])).toBeCloseTo(0.5, 2);
  });
});

describe("tones — frequency modulation", () => {
  it("spreads the spectrum into sidebands (vs a pure tone)", () => {
    const pure = peakFraction(tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8 }).channels[0]);
    const fm = peakFraction(tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8, modDepthHz: 400, modRateHz: 8 }).channels[0]);
    expect(fm).toBeLessThan(pure * 0.5);
    expect(fm).toBeLessThan(0.3);
  });

  it("keeps the peak amplitude under modulation", () => {
    expect(peak(tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8, modDepthHz: 400, modRateHz: 8 }).channels[0])).toBeCloseTo(0.8, 1);
  });

  it("a deeper modulation spreads more than a shallow one", () => {
    const shallow = peakFraction(tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8, modDepthHz: 50, modRateHz: 6 }).channels[0]);
    const deep = peakFraction(tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8, modDepthHz: 600, modRateHz: 6 }).channels[0]);
    expect(deep).toBeLessThan(shallow);
  });
});

describe("tones — harmonics & waveform", () => {
  it("adds overtones at 2f and 3f", () => {
    const harm = tones(500, 0.3, { sampleRate: SR, amplitude: 0.8, harmonics: 3 }).channels[0];
    const pure = tones(500, 0.3, { sampleRate: SR, amplitude: 0.8 }).channels[0];
    expect(binMag(harm, 1000)).toBeGreaterThan(binMag(pure, 1000) * 10); // 2f present
    expect(binMag(harm, 1500)).toBeGreaterThan(binMag(pure, 1500) * 10); // 3f present
  });

  it("clamps the harmonic count to five", () => {
    // 6f overtone should not appear (only up to 5 overtones = 6× the fundamental).
    const t = tones(500, 0.3, { sampleRate: SR, amplitude: 0.8, harmonics: 99 }).channels[0];
    expect(binMag(t, 500 * 7)).toBeLessThan(binMag(t, 500 * 6)); // 7f weaker than 6f (the last kept)
    expect(peak(t)).toBeLessThanOrEqual(0.81);
  });

  it("a square base carries the odd harmonics", () => {
    const sq = tones(500, 0.3, { sampleRate: SR, amplitude: 0.8, waveform: "square" }).channels[0];
    expect(binMag(sq, 1500)).toBeGreaterThan(100); // 3f (odd) present
  });
});

describe("tones — buffer shape", () => {
  it("respects duration, channels and sample rate", () => {
    const t = tones(1000, 0.1, { sampleRate: 22050, amplitude: 0.6, channels: 2 });
    expect(t.sampleRate).toBe(22050);
    expect(t.channels).toHaveLength(2);
    expect(frameCount(t)).toBe(Math.round(0.1 * 22050));
    expect(peak(t.channels[1])).toBeCloseTo(0.6, 1);
  });

  it("is deterministic and handles zero duration", () => {
    const a = tones(1000, 0.1, { sampleRate: SR, modDepthHz: 200, modRateHz: 5, harmonics: 2 });
    const b = tones(1000, 0.1, { sampleRate: SR, modDepthHz: 200, modRateHz: 5, harmonics: 2 });
    let diff = 0;
    for (let i = 0; i < a.channels[0].length; i++) diff = Math.max(diff, Math.abs(a.channels[0][i] - b.channels[0][i]));
    expect(diff).toBe(0);
    expect(frameCount(tones(1000, 0, {}))).toBe(0);
  });
});
