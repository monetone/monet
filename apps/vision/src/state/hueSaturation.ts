// ─────────────────────────────────────────────────────────────
// Hue/Saturation (Image ▸ Adjustments ▸ Hue/Saturation, ⌘U) — master HSL shift.
//
// Rotates hue, scales saturation, and lifts/lowers lightness. Engine-free so it
// unit-tests in node; two consumers, identical math:
//   • direct adjustment → `adjust_hue_saturation_params(params)`;
//   • kind-2 adjustment layer → the same parameter block.
// The transform MUST match `adjust.rs hue_saturation` / `pixel_adjust.rs` kind 2:
//   h = (h + hue) mod 360
//   s = clamp(s * (1 + sat), 0, 1)
//   l = light ≥ 0 ? l + (1-l)*light : l * (1 + light)
// where `hue` is degrees and `sat`/`light` are −1..1 fractions (the dialog's
// −100..100 sliders ÷ 100). The HSL conversions mirror `color.rs` exactly so a
// hue rotation of a primary lands on the next primary. Mirrors `exposure.ts` style.
// ─────────────────────────────────────────────────────────────

export interface HueSaturationState {
  /** Hue rotation in degrees (−180..180). With `colorize`, the target hue (0..360). */
  hue: number;
  /** Saturation in Photoshop units (−100..100); −100 fully desaturates. With
   *  `colorize`, the target saturation (0..100). */
  saturation: number;
  /** Lightness in Photoshop units (−100..100); +100 → white, −100 → black. */
  lightness: number;
  /** Colorize: map every pixel onto one hue at one saturation, keeping its
   *  lightness. The three sliders above become that colour; the ranges below
   *  select *by* hue, so they stop applying. Absent ⇒ off. */
  colorize?: boolean;
  /** Six colour ranges × `[hue, saturation, lightness]`, in `HS_RANGES` order and
   *  the same Photoshop units as the master triple. Absent ⇒ master only, and
   *  `packHueSaturation` then emits the legacy 3-float block. */
  ranges?: number[][];
}

export const HUE_MIN = -180;
export const HUE_MAX = 180;
export const SAT_MIN = -100;
export const SAT_MAX = 100;
export const LIGHT_MIN = -100;
export const LIGHT_MAX = 100;
/** Colorize's hue slider is an absolute hue, not a rotation. */
export const COLORIZE_HUE_MIN = 0;
export const COLORIZE_HUE_MAX = 360;
/** Colorize's saturation slider is an absolute amount, so it never goes negative. */
export const COLORIZE_SAT_MIN = 0;
export const COLORIZE_SAT_MAX = 100;

/** The six editable colour ranges, anchored every 60° — the same anchors (and the
 *  same triangular hue windows) Selective Color's chromatic bands use. */
export const HS_RANGES = ["Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas"] as const;

/** Length of the widened kind-2 parameter block:
 *  `[hue, sat, light, colorizeFlag, …6 ranges × [hue, sat, light]]`. */
export const HS_PARAMS = 22;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
const clamp = (n: number, min: number, max: number): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs)
// `(x.clamp(0,1)*255 + 0.5) as u8`.
const byte = (n: number): number => Math.round(clamp01(n) * 255);
// Positive modulo (matches Rust `rem_euclid`): result in [0, 360).
const mod360 = (n: number): number => Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
const hueShift = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  if (n >= HUE_MIN && n <= HUE_MAX) return n;
  const wrapped = mod360(n);
  return wrapped > HUE_MAX ? wrapped - 360 : wrapped;
};

/** A fresh, no-op Hue/Saturation state. */
export function defaultHueSaturation(): HueSaturationState {
  return {
    hue: 0,
    saturation: 0,
    lightness: 0,
    colorize: false,
    ranges: HS_RANGES.map(() => [0, 0, 0]),
  };
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Normalised RGB (0..1) → HSL (h 0..360°, s/l 0..1). Exact mirror of
 *  `color.rs rgb_to_hsl`. */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) * 0.5;
  if (Math.abs(max - min) < 1e-6) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

// Exact mirror of `color.rs hue_to_rgb`.
function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 0.5) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** HSL (h in degrees, s/l 0..1) → normalised RGB (0..1). Exact mirror of
 *  `color.rs hsl_to_rgb`. */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  if (Math.abs(s) < 1e-6) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  return {
    r: hueToRgb(p, q, hk + 1 / 3),
    g: hueToRgb(p, q, hk),
    b: hueToRgb(p, q, hk - 1 / 3),
  };
}

/** The direct-call args `[hue°, sat, light]` (sat/light as −1..1 fractions). */
export function hueSaturationArgs(state: HueSaturationState): [number, number, number] {
  return [state.hue, state.saturation / 100, state.lightness / 100];
}

/** Pack to kind-2 params. A deliberately legacy-shaped state still emits the
 * old three floats; the full dialog state emits all 22. */
export function packHueSaturation(state: HueSaturationState): Float32Array {
  const master = hueSaturationArgs(state);
  if (state.ranges === undefined && state.colorize === undefined) return new Float32Array(master);
  const out = new Float32Array(HS_PARAMS);
  out.set(master);
  out[3] = state.colorize ? 1 : 0;
  for (let band = 0; band < HS_RANGES.length; band++) {
    const range = state.ranges?.[band] ?? [0, 0, 0];
    out[4 + band * 3] = range[0] ?? 0;
    out[5 + band * 3] = (range[1] ?? 0) / 100;
    out[6 + band * 3] = (range[2] ?? 0) / 100;
  }
  return out;
}

/** Read legacy or widened kind-2 params into a complete editable state. */
export function unpackHueSaturation(params: ArrayLike<number>): HueSaturationState {
  const state = defaultHueSaturation();
  state.hue = params[0] ?? 0;
  state.saturation = (params[1] ?? 0) * 100;
  state.lightness = (params[2] ?? 0) * 100;
  if (params.length >= HS_PARAMS) {
    state.colorize = (params[3] ?? 0) > 0.5;
    state.ranges = HS_RANGES.map((_, band) => [
      params[4 + band * 3] ?? 0,
      (params[5 + band * 3] ?? 0) * 100,
      (params[6 + band * 3] ?? 0) * 100,
    ]);
  }
  state.hue = state.colorize ? mod360(state.hue) : hueShift(state.hue);
  state.saturation = state.colorize
    ? clamp(state.saturation, COLORIZE_SAT_MIN, COLORIZE_SAT_MAX)
    : clamp(state.saturation, SAT_MIN, SAT_MAX);
  state.lightness = clamp(state.lightness, LIGHT_MIN, LIGHT_MAX);
  return state;
}

/** Apply Hue/Saturation to an 8-bit pixel the way the engine does — to HSL, rotate
 *  hue, scale saturation, shift lightness, back to RGB — matching to 8-bit precision
 *  (this runs in f64; the engine's pipeline is f32). For tests/previews. */
export function applyHueSaturation(state: HueSaturationState, r: number, g: number, b: number): Rgb {
  const hsl = rgbToHsl(r / 255, g / 255, b / 255);
  let h: number;
  let s: number;
  let light = state.lightness / 100;
  if (state.colorize) {
    h = mod360(state.hue);
    s = clamp01(state.saturation / 100);
  } else {
    let hue = state.hue;
    let sat = state.saturation / 100;
    for (let band = 0; band < HS_RANGES.length; band++) {
      const range = state.ranges?.[band];
      if (!range) continue;
      let distance = Math.abs(hsl.h - band * 60);
      if (distance > 180) distance = 360 - distance;
      const weight = Math.max(0, 1 - distance / 60) * hsl.s;
      hue += (range[0] ?? 0) * weight;
      sat += ((range[1] ?? 0) / 100) * weight;
      light += ((range[2] ?? 0) / 100) * weight;
    }
    h = mod360(hsl.h + hue);
    s = clamp01(hsl.s * (1 + sat));
  }
  const l = light >= 0 ? hsl.l + (1 - hsl.l) * light : hsl.l * (1 + light);
  const out = hslToRgb(h, s, l);
  return { r: byte(out.r), g: byte(out.g), b: byte(out.b) };
}
