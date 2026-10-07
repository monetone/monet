// ─────────────────────────────────────────────────────────────
// Posterize (Image ▸ Adjustments ▸ Posterize) — per-channel level quantization.
//
// Snaps each channel to one of `levels` evenly-spaced values. Engine-free so it
// unit-tests in node; two consumers, identical math:
//   • direct adjustment → `adjust_posterize(levels)`;
//   • kind-7 adjustment layer → `Float32Array(1)` = `[levels]`.
// The quantizer MUST match `adjust.rs posterize` / `pixel_adjust.rs` kind 7:
// `n = max(levels, 2) - 1`; `q(c) = round(c * n) / n` per channel. Rust `f32::round`
// is half-away-from-zero, which for the non-negative `c*n` here equals JS
// `Math.round` (half-up). The result is clamped to [0,1] at write-out. Mirrors
// `exposure.ts` house style.
// ─────────────────────────────────────────────────────────────

export const POSTERIZE_MIN = 2;
// Photoshop allows up to 255 distinct levels (1 step per 8-bit code).
export const POSTERIZE_MAX = 255;
export const DEFAULT_LEVELS = 6;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs).
const byte = (n: number): number => Math.round(clamp01(n) * 255);

/** Round + clamp a levels value to the valid 2..255 range. */
export function clampLevels(levels: number): number {
  const n = Math.round(levels);
  return n < POSTERIZE_MIN ? POSTERIZE_MIN : n > POSTERIZE_MAX ? POSTERIZE_MAX : n;
}

/** The quantizer denominator `n = levels − 1` (≥1), matching the engine. */
export function posterizeStep(levels: number): number {
  return clampLevels(levels) - 1;
}

/** Quantize a normalised channel (0..1) to the nearest of `n+1` evenly-spaced
 *  levels: `round(c * n) / n`. Precondition: `n ≥ 1` (use {@link posterizeStep},
 *  which guarantees it); `n = 0` would divide by zero. */
export function quantize(c: number, n: number): number {
  return Math.round(c * n) / n;
}

/** The output 8-bit values a given `levels` snaps to (length = levels), e.g.
 *  levels 4 → [0, 85, 170, 255]. */
export function posterizeLevels(levels: number): number[] {
  const n = posterizeStep(levels);
  return Array.from({ length: n + 1 }, (_, k) => Math.round((k / n) * 255));
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply Posterize to an 8-bit pixel exactly as the engine does: quantize each
 *  channel independently to `levels` steps. For tests / previews. */
export function applyPosterize(levels: number, r: number, g: number, b: number): Rgb {
  const n = posterizeStep(levels);
  const ch = (v: number) => byte(quantize(v / 255, n));
  return { r: ch(r), g: ch(g), b: ch(b) };
}
