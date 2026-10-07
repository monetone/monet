// ─────────────────────────────────────────────────────────────
// ui/dynamics-presets.test — the shipped Dynamics Processing presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual DYNAMICS_PROCESSING_PRESETS objects (not stand-in
// curves) through the engine so each named preset provably does what its label
// claims: compress, expand, gate, limit.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { DYNAMICS_PROCESSING_PRESETS } from "./commands";

const SR = 44100;

const tone = (amp: number, freq = 440) => E.Generate.sine(freq, 0.2, { sampleRate: SR, amplitude: amp });

/** Peak over the settled (second-half) region, past the detector ramp-up. */
function settledPeak(ch: Float32Array): number {
  let m = 0;
  for (let i = ch.length >> 1; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]));
  return m;
}

const presetOpts = (id: string) => DYNAMICS_PROCESSING_PRESETS.find((p) => p.id === id)!.opts;

describe("DYNAMICS_PROCESSING_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(DYNAMICS_PROCESSING_PRESETS.map((p) => p.label)).toEqual(["Compressor 4:1", "Expander 2:1", "Noise Gate", "Limiter"]);
  });

  it("Compressor preset reduces a loud tone", () => {
    const loud = tone(0.9);
    const out = E.DSP.dynamicsProcessing(loud, presetOpts("dynCompress"));
    expect(settledPeak(out.channels[0])).toBeLessThan(settledPeak(loud.channels[0]));
  });

  it("Expander preset pushes a quiet tone further down", () => {
    const quiet = tone(0.003); // ≈ −50 dBFS, below the −40 knee
    const out = E.DSP.dynamicsProcessing(quiet, presetOpts("dynExpand"));
    expect(settledPeak(out.channels[0])).toBeLessThan(settledPeak(quiet.channels[0]) * 0.5);
  });

  it("Noise Gate preset silences a tone below the knee", () => {
    const quiet = tone(0.002); // ≈ −54 dBFS, under the −50 knee
    const out = E.DSP.dynamicsProcessing(quiet, presetOpts("dynGate"));
    expect(settledPeak(out.channels[0])).toBeLessThan(settledPeak(quiet.channels[0]) * 0.2);
  });

  it("Limiter preset caps a hot tone below the input", () => {
    const hot = tone(1.0);
    const out = E.DSP.dynamicsProcessing(hot, presetOpts("dynLimit"));
    expect(settledPeak(out.channels[0])).toBeLessThan(settledPeak(hot.channels[0]));
  });
});
