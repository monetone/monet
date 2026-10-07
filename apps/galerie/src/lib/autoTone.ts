// autoTone — a gentle "Auto" tone heuristic from a luminance histogram. Pure math
// (no engine), returning values in the recipe's Basic domain so the caller writes
// them straight onto recipe.basic. Mirrors Lightroom's Auto, which sets the whole
// tone group, not just exposure:
//   • exposure  — a stop shift bringing the median to a mid target
//   • contrast  — a small nudge from the tonal spread
//   • whites/blacks     — anchor the tonal endpoints toward (near-)white / black
//   • highlights/shadows — recover near-white clipping / open near-black clipping
//
// ponytail: light heuristic, NOT Adobe's ML Auto. Every slider is clamped tight —
// Auto can nudge, not wreck. Upgrade path: closed-loop solve each slider against a
// real render, or a learned model.

import { histogramStats } from "@monet-ui/monet-photo";

export interface AutoTone {
  /** Exposure in the recipe domain (≈ stops). */
  exposure: number;
  /** The remaining Basic tone sliders in the recipe domain (slider int * 0.01). */
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

const NEUTRAL: AutoTone = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The lowest level whose cumulative count reaches fraction `p` of the total. */
function percentileLevel(counts: number[], total: number, p: number): number {
  const target = p * total;
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i];
    if (acc >= target) return i;
  }
  return counts.length - 1;
}

/** Fraction of the total in levels [lo, hi). */
function massFraction(counts: number[], total: number, lo: number, hi: number): number {
  let s = 0;
  for (let i = lo; i < hi && i < counts.length; i++) s += counts[i];
  return s / total;
}

/** Auto tone from a 256-bin luma histogram (index = level 0..255, value = count).
 *  An all-zero / empty histogram yields a neutral (no-change) result. */
export function autoTone(counts: number[]): AutoTone {
  const { median, stdDev, pixels } = histogramStats(counts);
  if (pixels === 0) return { ...NEUTRAL };

  // Exposure: shift the median toward a pleasing mid target, in stops. Floor the
  // median fraction so a near-black image doesn't send log2 to -infinity.
  const mn = clamp(median / 255, 0.02, 1);
  const exposure = clamp(Math.log2(0.45 / mn), -4, 4);

  // Contrast: pull the tonal spread toward a moderately contrasty target. A flat
  // image (low std) gets positive contrast; an already-punchy one a mild pull-down.
  const targetStd = 52; // ~0.2 of the 0..255 range
  const contrast = clamp(((targetStd - stdDev) / targetStd) * 0.4, -0.25, 0.4);

  // Tonal endpoints, ignoring the extreme 0.5% tails so a few stray pixels don't
  // anchor the whole image.
  const pLo = percentileLevel(counts, pixels, 0.005);
  const pHi = percentileLevel(counts, pixels, 0.995);

  // Whites / Blacks anchor the endpoints toward near-white (245) and near-black
  // (10): a low top gets positive whites (lift), a high bottom negative blacks
  // (deepen). Kept moderate (±0.5 ≈ ±50 on the slider).
  const whites = clamp((245 - pHi) / 200, -0.5, 0.5);
  const blacks = clamp((10 - pLo) / 200, -0.5, 0.5);

  // Highlights recover near-white clipping (negative, proportional to how much sits
  // at the very top); Shadows open near-black clipping (positive). Return a literal
  // 0 when there's no clipping (avoids a -0 from negating zero mass).
  const hiMass = massFraction(counts, pixels, 250, 256);
  const highlights = hiMass > 0 ? clamp(-hiMass * 3, -0.5, 0) : 0;
  const shadows = clamp(massFraction(counts, pixels, 0, 6) * 3, 0, 0.5);

  return { exposure, contrast, highlights, shadows, whites, blacks };
}
