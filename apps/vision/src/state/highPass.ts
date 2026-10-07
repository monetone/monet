// ─────────────────────────────────────────────────────────────
// High Pass (Filter ▸ Other ▸ High Pass) — keep only the high-frequency detail.
// Subtract a Gaussian-blurred (low-frequency) copy from the original and re-centre
// on mid-gray: flat areas collapse to 50% gray, edges/texture stand out. The base
// of frequency-separation and a sharpening workflow. Engine-free so it unit-tests
// in node; the blur reuses the tested `gaussianKernel` / `convolve1D`.
//
// MUST match `filters.rs high_pass`: blur with a Gaussian of `radius.max(0.5)`;
// per channel (RGB only — alpha is left untouched) `v = 32768 + (orig − blurred)`
// (u16), clamped to [0, 65535]. Here values are normalised 0..1, so the mid is
// `0.5` (the engine's 32768/65535 ≈ 0.50001 — a sub-LSB difference). This is the
// continuous reference: the engine quantizes the blurred copy to u16 before
// subtracting and truncates the result to u16 (`as u16`) at storage. Mirrors the
// `unsharpMask.ts` house style.
// ─────────────────────────────────────────────────────────────

import { gaussianKernel, convolve1D } from "./gaussianKernel";

/** Mid-gray the high-pass result is centred on (the engine adds u16 32768 ≈ 0.5). */
export const MID = 0.5;
/** The engine floors the blur radius at 0.5 inside High Pass. */
export const MIN_RADIUS = 0.5;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);

/** The high-pass transform for one channel (values 0..1): re-centre the
 *  original-minus-blurred difference on `mid` gray, clamped. */
export function highPassChannel(orig: number, blurred: number, mid = MID): number {
  return clamp01(mid + (orig - blurred));
}

/** Apply High Pass to a 1-D signal (channels 0..1): Gaussian-blur it (radius floored
 *  at 0.5), then keep `mid + (orig − blurred)` per sample. A faithful 1-D reference
 *  of the engine's per-channel high pass. */
export function highPass1D(signal: readonly number[], radius: number): number[] {
  const blurred = convolve1D(signal, gaussianKernel(Math.max(radius, MIN_RADIUS)));
  return signal.map((o, i) => highPassChannel(o, blurred[i]));
}
