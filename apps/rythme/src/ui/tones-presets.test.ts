// ─────────────────────────────────────────────────────────────
// ui/tones-presets.test — the shipped Tones generator presets
// ─────────────────────────────────────────────────────────────
// Drives each TONES_PRESETS through the generator: the FM presets spread the
// spectrum into sidebands, the harmonic preset adds overtones, and the pure tone
// stays concentrated.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { TONES_PRESETS } from "./commands";

const SR = 44100;
const FFT = 8192;

function peakFraction(ch: Float32Array): number {
  const mags = E.Analysis.magnitudes(ch.subarray(0, FFT), FFT);
  let total = 0;
  let mx = 0;
  for (const m of mags) {
    total += m * m;
    mx = Math.max(mx, m);
  }
  return total > 0 ? (mx * mx) / total : 0;
}
const opts = (id: string) => TONES_PRESETS.find((p) => p.id === id)!;
const gen = (id: string) => {
  const p = opts(id);
  return E.Generate.tones(p.freq, p.opts.seconds ?? 2, { ...p.opts, sampleRate: SR }).channels[0];
};

describe("TONES_PRESETS", () => {
  it("exposes the five named presets", () => {
    expect(TONES_PRESETS.map((p) => p.label)).toEqual(["Pure 440", "Warble (FM)", "Vibrato", "Harmonic 220", "Siren"]);
  });

  it("the FM presets spread the spectrum more than the pure tone", () => {
    const pure = peakFraction(gen("tonPure"));
    expect(peakFraction(gen("tonWarble"))).toBeLessThan(pure);
    expect(peakFraction(gen("tonSiren"))).toBeLessThan(pure);
  });

  it("the Harmonic preset adds overtones", () => {
    const harm = gen("tonHarmonic");
    const m = (hz: number) => E.Analysis.magnitudes(harm.subarray(0, FFT), FFT)[Math.round((hz * FFT) / SR)];
    expect(m(440)).toBeGreaterThan(10); // 2× the 220 fundamental
    expect(m(660)).toBeGreaterThan(10); // 3×
  });
});
