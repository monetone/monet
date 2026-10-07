// ─────────────────────────────────────────────────────────────
// engine/analysis/phase-analysis.test — Audition-style Phase Analysis
// ─────────────────────────────────────────────────────────────
// Pins the phase meter: identical channels read +1 (mono-safe), a polarity-
// inverted channel reads −1 (cancels in mono), independent noise reads ~0, and
// the balance / width / mono-compatibility numbers track the stereo image.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { phaseAnalysis } from "./phase-analysis";

const SR = 44100;

const tone = () => sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5 }).channels[0];
const stereo = (l: Float32Array, r: Float32Array): AudioData => ({ sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] });
const scale = (ch: Float32Array, g: number) => ch.map((v) => v * g) as Float32Array;

describe("phaseAnalysis — correlation", () => {
  it("reads +1 for identical channels (mono-safe / in phase)", () => {
    const m = tone();
    const p = phaseAnalysis(stereo(m, m));
    expect(p.correlation).toBeGreaterThan(0.999);
    expect(p.width).toBeLessThan(0.001);
    expect(p.monoCompatibility).toBeGreaterThan(0.999);
    expect(p.balance).toBeCloseTo(0, 3);
    expect(p.stereo).toBe(true);
  });

  it("reads −1 for a polarity-inverted channel (cancels in mono)", () => {
    const m = tone();
    const p = phaseAnalysis(stereo(m, scale(m, -1)));
    expect(p.correlation).toBeLessThan(-0.999);
    expect(p.width).toBeGreaterThan(0.999);
    expect(p.monoCompatibility).toBeLessThan(0.001);
  });

  it("reads ~0 for independent (decorrelated) channels", () => {
    const l = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 1, channels: 1 }).channels[0];
    const r = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 999, channels: 1 }).channels[0];
    const p = phaseAnalysis(stereo(l, r));
    expect(Math.abs(p.correlation)).toBeLessThan(0.1);
    expect(p.width).toBeCloseTo(0.5, 1);
    expect(p.monoCompatibility).toBeCloseTo(0.707, 1);
    expect(Math.abs(p.balance)).toBeLessThan(0.05);
  });

  it("gives a correlation between 0 and 1 for partially shared content", () => {
    const m = tone();
    const noise = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 7, channels: 1 }).channels[0];
    const r = m.map((v, i) => v + noise[i]) as Float32Array; // shared tone + independent noise
    const p = phaseAnalysis(stereo(m, r));
    expect(p.correlation).toBeGreaterThan(0.1);
    expect(p.correlation).toBeLessThan(0.99);
  });
});

describe("phaseAnalysis — balance & width", () => {
  it("balances toward the louder channel", () => {
    const m = tone();
    expect(phaseAnalysis(stereo(m, scale(m, 0.5))).balance).toBeCloseTo(-0.6, 1); // left louder
    expect(phaseAnalysis(stereo(scale(m, 0.5), m)).balance).toBeCloseTo(0.6, 1); // right louder
  });

  it("width grows from mono (0) toward fully-side (1)", () => {
    const m = tone();
    const noise = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 5, channels: 1 }).channels[0];
    const wide = phaseAnalysis(stereo(m, m.map((v, i) => v + 0.5 * noise[i]) as Float32Array)).width;
    expect(phaseAnalysis(stereo(m, m)).width).toBeLessThan(wide);
    expect(wide).toBeLessThan(phaseAnalysis(stereo(m, scale(m, -1))).width);
  });
});

describe("phaseAnalysis — edges", () => {
  it("treats mono input as in-phase and not stereo", () => {
    const p = phaseAnalysis(sine(1000, 0.1, { sampleRate: SR, amplitude: 0.5 }));
    expect(p.stereo).toBe(false);
    expect(p.correlation).toBe(1);
    expect(p.width).toBe(0);
    expect(p.monoCompatibility).toBe(1);
  });

  it("treats silence as in-phase (nothing to cancel)", () => {
    const p = phaseAnalysis(createAudioData(2, 1000, SR));
    expect(p.stereo).toBe(true);
    expect(p.correlation).toBe(1);
    expect(p.width).toBe(0);
    expect(p.balance).toBe(0);
  });

  it("compares channels 0 and 1 of a multichannel buffer", () => {
    const m = tone();
    const d: AudioData = { sampleRate: SR, channels: [Float32Array.from(m), scale(m, -1), new Float32Array(m.length)] };
    expect(phaseAnalysis(d).correlation).toBeLessThan(-0.999);
  });

  it("is deterministic", () => {
    const m = tone();
    const noise = whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 3, channels: 1 }).channels[0];
    const d = stereo(m, noise);
    expect(phaseAnalysis(d)).toEqual(phaseAnalysis(d));
  });
});
