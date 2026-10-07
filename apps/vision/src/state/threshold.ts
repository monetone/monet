// ─────────────────────────────────────────────────────────────
// Threshold (Image ▸ Adjustments ▸ Threshold) — luminance binarization.
//
// Maps each pixel to pure black or white by comparing its luminance to a level.
// Engine-free so it unit-tests in node; two consumers, identical math:
//   • direct adjustment → `adjust_threshold(level)`;
//   • kind-8 adjustment layer → `Float32Array(1)` = `[level]`.
// The transform MUST match `adjust.rs threshold` / `pixel_adjust.rs` kind 8:
// `l = 0.299r + 0.587g + 0.114b` (Rec.601, on normalised channels);
// `v = l >= level ? 1 : 0`. `level` is the 0..1 fraction (the dialog's 0..255
// slider ÷ 255). Mirrors `posterize.ts` house style.
//
// Precision matters here: Threshold is a hard `>=` compare with no rounding to
// absorb drift (unlike the other adjustments, which quantize through `byte()`), so
// the luminance and level are computed in **single precision** (`Math.fround`) to
// match the engine's f32 pipeline bit-for-bit at boundary ties — e.g. pure white at
// level 255 stays white (in f32 the weights sum to exactly 1.0), whereas an f64
// computation would wrongly drop it to black.
// ─────────────────────────────────────────────────────────────

export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 255;
export const DEFAULT_THRESHOLD = 128;

// Rec.601 luminance weights — MUST match the engine.
export const LUMA_R = 0.299;
export const LUMA_G = 0.587;
export const LUMA_B = 0.114;

// Single-precision rounding — the engine runs the compare in f32 (see header).
const f32 = Math.fround;

/** Round + clamp a 0..255 level to the slider range. */
export function clampThreshold(level: number): number {
  const n = Math.round(level);
  return n < THRESHOLD_MIN ? THRESHOLD_MIN : n > THRESHOLD_MAX ? THRESHOLD_MAX : n;
}

/** The 0..1 fraction the engine compares against (`level/255`), in single
 *  precision to match the engine's f32 compare. */
export function thresholdFraction(level: number): number {
  return f32(clampThreshold(level) / 255);
}

/** Rec.601 luminance of an 8-bit pixel, normalised to 0..1 — computed in single
 *  precision (`0.299·r/255 + 0.587·g/255 + 0.114·b/255`) to match the engine's f32
 *  pipeline bit-for-bit at the hard `>=` boundary. */
export function thresholdLuminance(r: number, g: number, b: number): number {
  const rn = f32(r / 255);
  const gn = f32(g / 255);
  const bn = f32(b / 255);
  return f32(f32(f32(f32(LUMA_R) * rn) + f32(f32(LUMA_G) * gn)) + f32(f32(LUMA_B) * bn));
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply Threshold to an 8-bit pixel exactly as the engine does: white where the
 *  luminance meets the level, black otherwise. For tests / previews. */
export function applyThreshold(level: number, r: number, g: number, b: number): Rgb {
  const v = thresholdLuminance(r, g, b) >= thresholdFraction(level) ? 255 : 0;
  return { r: v, g: v, b: v };
}
