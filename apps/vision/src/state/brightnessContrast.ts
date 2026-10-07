// ─────────────────────────────────────────────────────────────
// Brightness/Contrast (Image ▸ Adjustments ▸ Brightness/Contrast) — linear tone.
//
// Scales each channel around mid-gray by (1 + contrast) and adds a brightness
// offset. Engine-free so it unit-tests in node; two consumers, identical math:
//   • direct adjustment → `adjust_brightness_contrast(brightness, contrast)`;
//   • kind-0 adjustment layer → `Float32Array(2)` = `[brightness, contrast]`.
// The per-channel transform MUST match `adjust.rs brightness_contrast` /
// `pixel_adjust.rs` kind 0: `(c - 0.5) * (1 + contrast) + 0.5 + brightness`, where
// `brightness`/`contrast` are −1..1 fractions (the dialog's −100..100 sliders ÷
// 100). The result is clamped to [0,1] only at write-out (engine `to8`). Mirrors
// `exposure.ts` / `vibrance.ts` house style.
// ─────────────────────────────────────────────────────────────

export interface BrightnessContrastState {
  /** Brightness in Photoshop units (−100..100); a flat offset on every channel. */
  brightness: number;
  /** Contrast in Photoshop units (−100..100); scales around mid-gray. −100 flattens
   *  to mid-gray, +100 doubles the slope. */
  contrast: number;
}

export const BRIGHTNESS_MIN = -100;
export const BRIGHTNESS_MAX = 100;
export const CONTRAST_MIN = -100;
export const CONTRAST_MAX = 100;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs).
const byte = (n: number): number => Math.round(clamp01(n) * 255);

/** A fresh, no-op Brightness/Contrast state. */
export function defaultBrightnessContrast(): BrightnessContrastState {
  return { brightness: 0, contrast: 0 };
}

/** The direct-call args `[brightness, contrast]` as −1..1 fractions. */
export function brightnessContrastArgs(state: BrightnessContrastState): [number, number] {
  return [state.brightness / 100, state.contrast / 100];
}

/** Pack to the kind-0 adjustment-layer params: `Float32Array(2)` =
 *  `[brightness, contrast]`. */
export function packBrightnessContrast(state: BrightnessContrastState): Float32Array {
  return new Float32Array(brightnessContrastArgs(state));
}

/** The transform on a single normalised channel (0..1 in, unclamped out so callers
 *  clamp once): `(c - 0.5) * contrastMul + 0.5 + brightness`. */
export function applyBrightnessContrastChannel(c: number, brightness: number, contrastMul: number): number {
  return (c - 0.5) * contrastMul + 0.5 + brightness;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply Brightness/Contrast to an 8-bit pixel the way the engine does — scale
 *  around mid-gray by (1 + contrast), add brightness, clamp at write-out — matching
 *  to 8-bit precision (this runs in f64; the engine's pipeline is f32). For tests /
 *  previews. */
export function applyBrightnessContrast(state: BrightnessContrastState, r: number, g: number, b: number): Rgb {
  const [brightness, contrast] = brightnessContrastArgs(state);
  const contrastMul = 1 + contrast;
  const ch = (v: number) => byte(applyBrightnessContrastChannel(v / 255, brightness, contrastMul));
  return { r: ch(r), g: ch(g), b: ch(b) };
}
