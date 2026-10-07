// ─────────────────────────────────────────────────────────────
// ui/waveshaper-presets.test — the shipped Waveshaper Distortion presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual WAVESHAPER_PRESETS objects through the engine so each
// named preset provably reshapes a loud sine, and the Hard Clip preset caps the
// peak at its curve ceiling.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { magnitudes } from "../engine/analysis/fft";
import { WAVESHAPER_PRESETS } from "./commands";

const SR = 44100;
const FFT = 8192;

/** Raw-FFT magnitude at `freq`; place `freq` on an exact bin (freq = k·SR/FFT). */
function magAt(ch: Float32Array, freq: number): number {
  return magnitudes(ch, FFT)[Math.round((freq * FFT) / SR)];
}

// A loud sine that the nonlinear curves visibly reshape.
const loud = () => E.Generate.sine(220, 0.2, { sampleRate: SR, amplitude: 0.95 });

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function peak(ch: Float32Array): number {
  let p = 0;
  for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
}

describe("WAVESHAPER_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(WAVESHAPER_PRESETS.map((p) => p.label)).toEqual([
      "Hard Clip",
      "Soft Saturate",
      "Fuzz",
      "Full-Wave Rectify",
    ]);
  });

  for (const p of WAVESHAPER_PRESETS) {
    it(`${p.label} measurably reshapes a loud sine`, () => {
      const t = loud();
      const out = E.DSP.waveshaper(t, p.opts);
      expect(maxAbsDiff(out.channels[0], t.channels[0])).toBeGreaterThan(0.05);
    });
  }

  it("Hard Clip caps the peak at its ±0.5 ceiling", () => {
    const opts = WAVESHAPER_PRESETS.find((p) => p.id === "wsHardClip")!.opts;
    const out = E.DSP.waveshaper(loud(), opts);
    expect(peak(out.channels[0])).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("Fuzz generates even-harmonic (2f) energy from its asymmetric curve", () => {
    const opts = WAVESHAPER_PRESETS.find((p) => p.id === "wsFuzz")!.opts;
    const f = (130 * SR) / FFT; // ≈ 700 Hz — f and 2f both land on exact bins
    const t = E.Generate.sine(f, FFT / SR, { sampleRate: SR, amplitude: 0.8 });
    const out = E.DSP.waveshaper(t, opts);
    const dry2f = magAt(t.channels[0], 2 * f);
    const wet2f = magAt(out.channels[0], 2 * f);
    expect(wet2f).toBeGreaterThan(dry2f * 20 + 1e-2);
  });

  it("Full-Wave Rectify makes the signal non-negative", () => {
    const opts = WAVESHAPER_PRESETS.find((p) => p.id === "wsRectify")!.opts;
    const out = E.DSP.waveshaper(loud(), opts);
    let min = Infinity;
    for (const v of out.channels[0]) min = Math.min(min, v);
    expect(min).toBeGreaterThanOrEqual(-1e-6);
  });
});
