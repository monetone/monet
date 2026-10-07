// ─────────────────────────────────────────────────────────────
// Vibrance (Image ▸ Adjustments ▸ Vibrance) — saturation that protects highlights.
//
// Boosts saturation, but weighted by (1 − s) so already-vivid pixels move less than
// muted ones (Photoshop's skin-tone-friendly Vibrance), plus a flat Saturation add.
// Engine-free so it unit-tests in node; two consumers, identical math:
//   • direct adjustment → `adjust_vibrance(vib, sat)`;
//   • kind-3 adjustment layer → `Float32Array(2)` = `[vib, sat]`.
// The transform MUST match `adjust.rs vibrance` / `pixel_adjust.rs` kind 3:
//   ns = clamp(s + vib*(1 - s) + sat, 0, 1); hsv_to_rgb(h, ns, v)
// where `vib`/`sat` are −1..1 fractions (the dialog's −100..100 sliders ÷ 100). The
// HSV conversions mirror `color.rs` exactly. Mirrors `hueSaturation.ts` style.
// ─────────────────────────────────────────────────────────────

export interface VibranceState {
  /** Vibrance in Photoshop units (−100..100); boosts muted pixels most. */
  vibrance: number;
  /** Flat saturation add in Photoshop units (−100..100). */
  saturation: number;
}

export const VIBRANCE_MIN = -100;
export const VIBRANCE_MAX = 100;
export const SATURATION_MIN = -100;
export const SATURATION_MAX = 100;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs).
const byte = (n: number): number => Math.round(clamp01(n) * 255);
// Positive modulo (matches Rust `rem_euclid`).
const remEuclid = (n: number, m: number): number => ((n % m) + m) % m;

/** A fresh, no-op Vibrance state. */
export function defaultVibrance(): VibranceState {
  return { vibrance: 0, saturation: 0 };
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Normalised RGB (0..1) → HSV (h 0..360°, s/v 0..1). Exact mirror of
 *  `color.rs rgb_to_hsv`. */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max <= 0 ? 0 : d / max;
  let h: number;
  if (Math.abs(d) < 1e-6) h = 0;
  else if (max === r) h = remEuclid((g - b) / d, 6);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, v };
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** HSV (h in degrees, s/v 0..1) → normalised RGB (0..1). Exact mirror of
 *  `color.rs hsv_to_rgb`. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hh = remEuclid(h / 60, 6);
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

/** The direct-call args `[vib, sat]` (as −1..1 fractions). */
export function vibranceArgs(state: VibranceState): [number, number] {
  return [state.vibrance / 100, state.saturation / 100];
}

/** Pack to the kind-3 adjustment-layer params: `Float32Array(2)` = `[vib, sat]`. */
export function packVibrance(state: VibranceState): Float32Array {
  return new Float32Array(vibranceArgs(state));
}

/** The new saturation for an input saturation `s` (0..1) under this state:
 *  `clamp(s + vib*(1-s) + sat, 0, 1)`. Exposed so the "protects vivid pixels"
 *  property is testable directly. */
export function vibranceSaturation(state: VibranceState, s: number): number {
  const [vib, sat] = vibranceArgs(state);
  return clamp01(s + vib * (1 - s) + sat);
}

/** Apply Vibrance to an 8-bit pixel the way the engine does — to HSV, remap
 *  saturation, back to RGB — matching to 8-bit precision (this runs in f64; the
 *  engine's pipeline is f32). For tests / previews. */
export function applyVibrance(state: VibranceState, r: number, g: number, b: number): Rgb {
  const hsv = rgbToHsv(r / 255, g / 255, b / 255);
  const ns = vibranceSaturation(state, hsv.s);
  const out = hsvToRgb(hsv.h, ns, hsv.v);
  return { r: byte(out.r), g: byte(out.g), b: byte(out.b) };
}
