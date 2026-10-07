// ─────────────────────────────────────────────────────────────
// engine/dsp/eq — parametric & graphic equalizers
// ─────────────────────────────────────────────────────────────
// Both EQs are series cascades of biquad sections, so a flat setting (no bands
// / all gains 0) is a transparent pass-through.

import type { AudioData } from "../audio/types";
import { applyBiquad, biquadMagnitude, designBiquad, type BiquadSpec } from "./biquad";

export interface EQBand extends BiquadSpec {
  enabled?: boolean;
}

/** Apply a parametric EQ: each enabled band is one biquad in series. */
export function parametricEQ(d: AudioData, bands: EQBand[]): AudioData {
  let out = d;
  for (const band of bands) {
    if (band.enabled === false) continue;
    out = applyBiquad(out, band);
  }
  return out;
}

/** Standard ISO-ish octave centers for a 10-band graphic EQ. */
export const GRAPHIC_EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Graphic EQ: one peaking band per entry in `gainsDb`, centered on
 * `freqs` (defaults to the 10-band octave set). A zero-gain band is skipped.
 */
export function graphicEQ(d: AudioData, gainsDb: number[], freqs: number[] = GRAPHIC_EQ_FREQS): AudioData {
  const bands: EQBand[] = [];
  for (let i = 0; i < gainsDb.length && i < freqs.length; i++) {
    if (Math.abs(gainsDb[i]) < 1e-3) continue;
    bands.push({ type: "peaking", freq: freqs[i], q: 1.4, gainDb: gainsDb[i] });
  }
  return parametricEQ(d, bands);
}

/**
 * Sample the combined magnitude response (in dB) of a set of bands across a log
 * frequency axis — for drawing the EQ curve in the UI.
 */
export function eqResponse(bands: EQBand[], sampleRate: number, points = 128, fMin = 20, fMax = 20000): { f: number; db: number }[] {
  const coeffs = bands.filter((b) => b.enabled !== false).map((b) => designBiquad(b, sampleRate));
  const out: { f: number; db: number }[] = [];
  for (let i = 0; i < points; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / (points - 1));
    let mag = 1;
    for (const c of coeffs) mag *= biquadMagnitude(c, f, sampleRate);
    out.push({ f, db: 20 * Math.log10(mag || 1e-9) });
  }
  return out;
}
