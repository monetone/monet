// ─────────────────────────────────────────────────────────────
// Exposure (Image ▸ Adjustments ▸ Exposure) — pure tone math.
//
// Scales linear-ish exposure (in stops), adds an offset (lifts/lowers the floor),
// and applies a gamma. Engine-free so it unit-tests in node. The direct dialog
// calls `adjust_exposure(exposure, offset, gamma)`; the kind-9 adjustment layer
// (registry-driven) takes `Float32Array(3)` = `[exposure, offset, gamma]`, which
// `packExposure` produces for parity.
// The per-channel transform MUST match `adjust.rs exposure` / `pixel_adjust.rs`
// kind 9: `mul = 2^exposure`, `ig = 1/max(gamma, 1e-4)`,
// `f(c) = max(c*mul + offset, 0)^ig`. The `max(…,0)` is load-bearing: a negative
// base under a fractional power is NaN, so it must clamp to 0 first. The result is
// clamped to [0,1] only at write-out (matching the engine's `to8`). Mirrors
// `photoFilter.ts` / `colorBalance.ts` house style.
// ─────────────────────────────────────────────────────────────

export interface ExposureState {
  /** Exposure in stops; the channel is multiplied by 2^exposure. */
  exposure: number;
  /** Flat offset added after the exposure multiply (shifts the black point). */
  offset: number;
  /** Gamma; the channel is raised to 1/gamma. 1 = linear. */
  gamma: number;
}

// Slider ranges (match the dialog / adjustment-layer registry).
export const EXPOSURE_MIN = -3;
export const EXPOSURE_MAX = 3;
export const OFFSET_MIN = -0.5;
export const OFFSET_MAX = 0.5;
export const GAMMA_MIN = 0.1;
export const GAMMA_MAX = 3;

// Engine guard: gamma is floored here before the reciprocal (matches
// `gamma.max(1e-4)`), so gamma 0 can never divide by zero.
export const GAMMA_FLOOR = 1e-4;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs)
// `(x.clamp(0,1)*255 + 0.5) as u8`, since JS Math.round is round-half-up for
// non-negative values.
const byte = (n: number): number => Math.round(clamp01(n) * 255);

/** A fresh, no-op Exposure state (0 stops, no offset, gamma 1). */
export function defaultExposure(): ExposureState {
  return { exposure: 0, offset: 0, gamma: 1 };
}

/** The exposure multiplier 2^stops. */
export function exposureMultiplier(exposure: number): number {
  return 2 ** exposure;
}

/** Pack to the kind-9 adjustment-layer params: `Float32Array(3)` =
 *  `[exposure, offset, gamma]`. */
export function packExposure(state: ExposureState): Float32Array {
  return new Float32Array([state.exposure, state.offset, state.gamma]);
}

/** The exposure transform on a single normalised channel (0..1 in, unclamped out
 *  so callers can clamp once): `max(c*mul + offset, 0)^invGamma`. */
export function applyExposureChannel(c: number, mul: number, offset: number, invGamma: number): number {
  const base = c * mul + offset;
  return Math.pow(base > 0 ? base : 0, invGamma);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply Exposure to an 8-bit pixel exactly as the engine does: multiply by
 *  2^exposure, add offset, clamp the base to ≥0, raise to 1/gamma; the engine
 *  clamps to [0,1] at write-out, which `byte` reproduces. For tests / previews. */
export function applyExposure(state: ExposureState, r: number, g: number, b: number): Rgb {
  const mul = exposureMultiplier(state.exposure);
  const invGamma = 1 / Math.max(state.gamma, GAMMA_FLOOR);
  const ch = (c: number) => byte(applyExposureChannel(c / 255, mul, state.offset, invGamma));
  return { r: ch(r), g: ch(g), b: ch(b) };
}
