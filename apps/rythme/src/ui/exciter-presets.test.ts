// ─────────────────────────────────────────────────────────────
// ui/exciter-presets.test — the shipped Exciter presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual EXCITER_PRESETS objects through the engine so each named
// preset provably synthesizes a new harmonic for a tone above its high-pass.
// Tape/Retro/Air are symmetric (odd → 3f); Tube is asymmetric (even → 2f).
// Harmonics above Nyquist are alias-folded to the bin they actually land in.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { EXCITER_PRESETS } from "./commands";

const SR = 44100;
const FFT = 8192;

const tone = (freq: number) => E.Generate.sine(freq, 0.3, { sampleRate: SR, amplitude: 0.5 });

/** Fold a frequency above Nyquist back to the bin it aliases into. */
function aliasFold(freq: number): number {
  const m = ((freq % SR) + SR) % SR;
  return m > SR / 2 ? SR - m : m;
}

/** FFT magnitude at `freq` over a settled slice (past the high-pass transient). */
function magAt(ch: Float32Array, freq: number): number {
  const slice = ch.subarray(ch.length - FFT);
  const mags = magnitudesOf(slice);
  return mags[Math.round((aliasFold(freq) * FFT) / SR)];
}

function magnitudesOf(slice: Float32Array): Float64Array {
  return E.Analysis.magnitudes(slice, FFT);
}

describe("EXCITER_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(EXCITER_PRESETS.map((p) => p.label)).toEqual(["Tape (warm)", "Retro (bright)", "Tube (rich)", "Air (sparkle)"]);
  });

  for (const p of EXCITER_PRESETS) {
    it(`${p.label} synthesizes a new harmonic above its high-pass`, () => {
      // Above the high-pass corner, and low enough that the harmonic's (possibly
      // alias-folded) bin lands clear of the corner — e.g. Air's 3f folds to 14.1 kHz.
      const probe = (p.opts.frequency ?? 3000) * 1.25;
      const harmonic = p.opts.mode === "tube" ? 2 * probe : 3 * probe; // even vs odd
      const t = tone(probe);
      const out = E.DSP.exciter(t, p.opts);
      expect(magAt(out.channels[0], harmonic)).toBeGreaterThan(magAt(t.channels[0], harmonic) * 10 + 1e-3);
    });
  }
});
