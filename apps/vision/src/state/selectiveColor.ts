// ─────────────────────────────────────────────────────────────
// Selective Color (Image ▸ Adjustments ▸ Selective Color) — per-band CMYK shifts.
//
// Adjusts CMYK ink amounts within nine colour bands (Reds…Magentas + Whites,
// Neutrals, Blacks), in Relative or Absolute mode. Engine-free so it unit-tests in
// node; two consumers:
//   • direct adjustment → `adjust_selective_color(corr, relative)` — `corr` is 9
//     bands × [C,M,Y,K] (36 floats, fractions);
//   • kind-15 adjustment layer → `Float32Array(37)` = `[relativeFlag, …corr]`.
// The classification + correction MUST match `adjust.rs band_membership` /
// `selective_color_pixel` (and `pixel_adjust.rs` kind 15). The HSL hue used for the
// chromatic bands reuses the exact `rgbToHsl` mirror from `./hueSaturation`.
// Mirrors `colorBalance.ts` / `vibrance.ts` house style.
// ─────────────────────────────────────────────────────────────

import { rgbToHsl } from "./hueSaturation";

/** The nine Selective Color bands, in engine order (chromatic 0..5 every 60°, then
 *  Whites/Neutrals/Blacks). */
export const SELECTIVE_BANDS = [
  "Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas", "Whites", "Neutrals", "Blacks",
] as const;

/** The per-band sliders, in order: Cyan, Magenta, Yellow, Black. */
export const CMYK_LABELS = ["Cyan", "Magenta", "Yellow", "Black"] as const;

export const CMYK_MIN = -100;
export const CMYK_MAX = 100;

export interface SelectiveColorState {
  /** 9 bands × [C, M, Y, K] in Photoshop units (−100..100). */
  bands: number[][];
  /** Relative (scale by existing ink) vs Absolute. Photoshop defaults to Relative. */
  relative: boolean;
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs).
const byte = (n: number): number => Math.round(clamp01(n) * 255);

/** A fresh, no-op Selective Color state (all sliders 0, Relative mode). */
export function defaultSelectiveColor(): SelectiveColorState {
  return { bands: SELECTIVE_BANDS.map(() => [0, 0, 0, 0]), relative: true };
}

/** Immutably set one CMYK channel of one band, clamped to −100..100. */
export function setBandCmyk(
  state: SelectiveColorState,
  band: number,
  channel: number,
  value: number,
): SelectiveColorState {
  const v = clamp(value, CMYK_MIN, CMYK_MAX);
  return {
    ...state,
    bands: state.bands.map((row, b) => (b === band ? row.map((x, j) => (j === channel ? v : x)) : row)),
  };
}

/** The corr array the direct engine call expects: 9 bands × [C,M,Y,K] as fractions
 *  (÷100), 36 floats. */
export function packSelectiveColor(state: SelectiveColorState): Float32Array {
  return new Float32Array(state.bands.flat().map((x) => x / 100));
}

/** The kind-15 adjustment-layer params: `Float32Array(37)` = `[relativeFlag, …corr]`.
 *  Provided for parity / tests — the layer dialog currently assembles this inline. */
export function packSelectiveColorLayer(state: SelectiveColorState): Float32Array {
  const corr = state.bands.flat().map((x) => x / 100);
  return new Float32Array([state.relative ? 1 : 0, ...corr]);
}

/** Soft membership (0..1) of a normalised pixel in `band` (0..8). Exact mirror of
 *  the engine's `band_membership`: chromatic bands are a 60°-half-width hue window
 *  weighted by chroma; Whites/Neutrals/Blacks are derived from min/max channels. */
export function bandMembership(band: number, r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const chroma = mx - mn;
  const whites = clamp01((mn - 0.5) * 2);
  const blacks = clamp01((0.5 - mx) * 2);
  if (band <= 5) {
    const h = rgbToHsl(r, g, b).h;
    const hc = band * 60;
    let dh = Math.abs(h - hc);
    if (dh > 180) dh = 360 - dh;
    return clamp01(1 - dh / 60) * chroma;
  }
  if (band === 6) return whites;
  if (band === 7) return clamp01(1 - chroma - whites - blacks);
  if (band === 8) return blacks;
  return 0;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply Selective Color to an 8-bit pixel exactly as the engine does: convert to
 *  CMY (1−rgb), accumulate per-band CMYK shifts (relative scales by the existing
 *  ink), apply the Black slider (darken if ≥0, lighten if <0), back to RGB. For
 *  tests / previews. */
export function applySelectiveColor(state: SelectiveColorState, r: number, g: number, b: number): Rgb {
  const corr = packSelectiveColor(state);
  const relative = state.relative;
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const c0 = 1 - rn;
  const m0 = 1 - gn;
  const y0 = 1 - bn;
  let dc = 0;
  let dm = 0;
  let dy = 0;
  let dk = 0;
  for (let band = 0; band < 9; band++) {
    const base = band * 4;
    const w = bandMembership(band, rn, gn, bn);
    if (w <= 0) continue;
    dc += (relative ? c0 * corr[base] : corr[base]) * w;
    dm += (relative ? m0 * corr[base + 1] : corr[base + 1]) * w;
    dy += (relative ? y0 * corr[base + 2] : corr[base + 2]) * w;
    dk += corr[base + 3] * w;
  }
  const c = clamp01(c0 + dc);
  const m = clamp01(m0 + dm);
  const y = clamp01(y0 + dy);
  let nr = 1 - c;
  let ng = 1 - m;
  let nb = 1 - y;
  if (dk >= 0) {
    const f = clamp01(1 - dk);
    nr *= f;
    ng *= f;
    nb *= f;
  } else {
    const t = clamp01(-dk);
    nr += (1 - nr) * t;
    ng += (1 - ng) * t;
    nb += (1 - nb) * t;
  }
  return { r: byte(nr), g: byte(ng), b: byte(nb) };
}
