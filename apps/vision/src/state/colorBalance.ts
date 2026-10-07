// ─────────────────────────────────────────────────────────────
// Color Balance (Image ▸ Adjustments ▸ Color Balance, ⌘B) — pure shift math.
//
// Shifts colour separately in Shadows / Midtones / Highlights along three axes
// (Cyan–Red, Magenta–Green, Yellow–Blue), optionally preserving luminosity.
// Engine-free so it unit-tests in node; two consumers:
//   • direct adjustment → `adjust_color_balance(sh, mid, hi, preserve_lum)`;
//   • kind-10 adjustment layer → `Float32Array(9)` = `[sh×3, mid×3, hi×3]` (no
//     preserve-luminosity on that path).
// The weighting + shift MUST match `adjust.rs color_balance` / `pixel_adjust.rs`
// kind 10: `l = 0.299r+0.587g+0.114b`; `ws=(1-l)²`, `wh=l²`, `wm=max(1-|2l-1|,0)`;
// `shift(i) = 0.25·(sh[i]·ws + mid[i]·wm + hi[i]·wh)`. Params are fractions
// (slider/100). Mirrors `photoFilter.ts` / `channelMixer.ts` house style.
// ─────────────────────────────────────────────────────────────

/** A colour shift along the three Color Balance axes, in Photoshop slider units
 *  (−100..100). Positive pushes toward Red / Green / Blue; negative toward Cyan /
 *  Magenta / Yellow. */
export interface ColorBalanceTriad {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
}

export type ToneRange = "shadows" | "midtones" | "highlights";

export interface ColorBalanceState {
  shadows: ColorBalanceTriad;
  midtones: ColorBalanceTriad;
  highlights: ColorBalanceTriad;
  /** Keep overall brightness constant ("Preserve Luminosity"). Honoured by the
   *  direct adjustment and the kind-10 layer alike. */
  preserveLuminosity: boolean;
}

export const BALANCE_MIN = -100;
export const BALANCE_MAX = 100;

export const TONE_RANGES: { key: ToneRange; label: string }[] = [
  { key: "shadows", label: "Shadows" },
  { key: "midtones", label: "Midtones" },
  { key: "highlights", label: "Highlights" },
];

// Axis order matches the engine's channel order: cyanRed→R, magentaGreen→G,
// yellowBlue→B.
export const COLOR_BALANCE_AXES: { key: keyof ColorBalanceTriad; negative: string; positive: string }[] = [
  { key: "cyanRed", negative: "Cyan", positive: "Red" },
  { key: "magentaGreen", negative: "Magenta", positive: "Green" },
  { key: "yellowBlue", negative: "Yellow", positive: "Blue" },
];

// Rec.601 luminance weights — MUST match the engine.
export const LUMA_R = 0.299;
export const LUMA_G = 0.587;
export const LUMA_B = 0.114;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` quantization
// `(x.clamp(0,1)*255 + 0.5) as u8` (color.rs), since JS Math.round is round-half-up
// for non-negative values.
const byte = (n: number): number => Math.round(clamp01(n) * 255);

export const zeroTriad = (): ColorBalanceTriad => ({ cyanRed: 0, magentaGreen: 0, yellowBlue: 0 });

/** A fresh, no-op Color Balance state (all axes 0, preserve luminosity on). */
export function defaultColorBalance(): ColorBalanceState {
  return { shadows: zeroTriad(), midtones: zeroTriad(), highlights: zeroTriad(), preserveLuminosity: true };
}

/** Immutably set one axis of one tonal range, clamped to −100..100. */
export function setBalance(
  state: ColorBalanceState,
  range: ToneRange,
  axis: keyof ColorBalanceTriad,
  value: number,
): ColorBalanceState {
  return { ...state, [range]: { ...state[range], [axis]: clamp(value, BALANCE_MIN, BALANCE_MAX) } };
}

// A triad as engine fractions `[cr, mg, yb]` (channel R/G/B order).
function triadArray(t: ColorBalanceTriad): [number, number, number] {
  return [t.cyanRed / 100, t.magentaGreen / 100, t.yellowBlue / 100];
}

/** Pack to the three `Float32Array(3)` the direct engine call expects. */
export function packColorBalanceTriads(state: ColorBalanceState): {
  sh: Float32Array;
  mid: Float32Array;
  hi: Float32Array;
} {
  return {
    sh: new Float32Array(triadArray(state.shadows)),
    mid: new Float32Array(triadArray(state.midtones)),
    hi: new Float32Array(triadArray(state.highlights)),
  };
}

/** Pack to the kind-10 adjustment-layer params: `Float32Array(9)` =
 *  `[sh×3, mid×3, hi×3]`. Preserve-luminosity is not part of this path. */
export function packColorBalanceLayer(state: ColorBalanceState): Float32Array {
  return new Float32Array([
    ...triadArray(state.shadows), ...triadArray(state.midtones), ...triadArray(state.highlights),
    state.preserveLuminosity ? 1 : 0,
  ]);
}

export interface ToneWeights {
  shadow: number;
  midtone: number;
  highlight: number;
}

/** The smooth tonal weights at luminance `l` (0..1): shadows peak at black,
 *  highlights at white, midtones at mid-gray. Matches the engine for in-gamut
 *  luminance (the clamp is defensive — the engine never sees l outside [0,1]). */
export function toneWeights(l: number): ToneWeights {
  const c = clamp01(l);
  return {
    shadow: (1 - c) * (1 - c),
    highlight: c * c,
    midtone: Math.max(1 - Math.abs(2 * c - 1), 0),
  };
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply Color Balance to an 8-bit pixel exactly as the engine does: weight each
 *  range's shift by the pixel's luminance, add, clamp; then (if preserving
 *  luminosity) add back the luminance delta and clamp. For tests / previews. */
export function applyColorBalance(state: ColorBalanceState, r: number, g: number, b: number): Rgb {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const l = LUMA_R * rn + LUMA_G * gn + LUMA_B * bn;
  const w = toneWeights(l);
  const sh = triadArray(state.shadows);
  const mid = triadArray(state.midtones);
  const hi = triadArray(state.highlights);
  const shift = (i: number) => 0.25 * (sh[i] * w.shadow + mid[i] * w.midtone + hi[i] * w.highlight);
  let nr = clamp01(rn + shift(0));
  let ng = clamp01(gn + shift(1));
  let nb = clamp01(bn + shift(2));
  if (state.preserveLuminosity) {
    const nl = LUMA_R * nr + LUMA_G * ng + LUMA_B * nb;
    const d = l - nl;
    nr = clamp01(nr + d);
    ng = clamp01(ng + d);
    nb = clamp01(nb + d);
  }
  return { r: byte(nr), g: byte(ng), b: byte(nb) };
}
