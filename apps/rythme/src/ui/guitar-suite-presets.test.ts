// ─────────────────────────────────────────────────────────────
// ui/guitar-suite-presets.test — the shipped Guitar Suite presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual GUITAR_SUITE_PRESETS objects through the engine so each
// named preset provably shapes a tone — adding harmonic content above the
// fundamental (overdrive + presence) that the dry signal does not have.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { GUITAR_SUITE_PRESETS } from "./commands";

const SR = 44100;
const FFT = 8192;

const tone = (freq: number) => E.Generate.sine(freq, 0.3, { sampleRate: SR, amplitude: 0.4 });

/** Sum of FFT magnitudes at the 2nd–5th harmonics of `f` (all in the cab band).
 *  Hann-windows first so the strong fundamental's spectral leakage doesn't masquerade
 *  as harmonic energy — leaving only genuine overdrive harmonics in those bins. */
function harmonicEnergy(ch: Float32Array, f: number): number {
  const slice = ch.subarray(ch.length - FFT);
  const win = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) win[i] = slice[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const mags = E.Analysis.magnitudes(win, FFT);
  let sum = 0;
  for (let k = 2; k <= 5; k++) sum += mags[Math.round((k * f * FFT) / SR)];
  return sum;
}

describe("GUITAR_SUITE_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(GUITAR_SUITE_PRESETS.map((p) => p.label)).toEqual(["Clean", "Crunch", "Lead", "Fuzz"]);
  });

  for (const p of GUITAR_SUITE_PRESETS) {
    it(`${p.label} adds harmonic content above the fundamental`, () => {
      const f = 400;
      const t = tone(f);
      const out = E.DSP.guitarSuite(t, p.opts);
      expect(harmonicEnergy(out.channels[0], f)).toBeGreaterThan(harmonicEnergy(t.channels[0], f) * 5 + 1e-2);
    });
  }
});
