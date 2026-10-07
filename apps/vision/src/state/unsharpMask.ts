// ─────────────────────────────────────────────────────────────
// Unsharp Mask (Filter ▸ Sharpen ▸ Unsharp Mask) — edge-aware sharpening. Subtract
// a Gaussian-blurred copy from the original and add the (scaled) difference back,
// but only where that difference exceeds a threshold (so flat areas and noise stay
// untouched). Engine-free so it unit-tests in node; the blur reuses the tested
// `gaussianKernel` / `convolve1D`.
//
// MUST match `filters.rs unsharp_mask`: blur with a Gaussian of `radius.max(0.3)`;
// per channel `diff = orig − blurred`; if `|diff| ≥ threshold` then `orig + diff *
// amount` (clamped), else leave `orig`. The engine works in u16 and compares
// `|diff| ≥ threshold·65535`; here values are normalised 0..1, so the threshold is
// compared directly. The engine applies this to the RGB channels only (alpha is left
// untouched). This is the continuous reference: the engine quantizes the blurred copy
// to u16 *before* diffing, and truncates the result to u16 at storage, so it can
// differ sub-LSB from this continuous math. Mirrors the `gaussianKernel.ts` style.
// ─────────────────────────────────────────────────────────────

import { gaussianKernel, convolve1D } from "./gaussianKernel";

// The engine floors the blur radius at 0.3 inside Unsharp Mask.
export const MIN_RADIUS = 0.3;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);

/** The unsharp-mask transform for one channel (all values 0..1): add `amount` of
 *  the original-minus-blurred difference back, but only when `|diff| ≥ threshold`. */
export function unsharpChannel(orig: number, blurred: number, amount: number, threshold: number): number {
  const diff = orig - blurred;
  if (Math.abs(diff) < threshold) return orig;
  return clamp01(orig + diff * amount);
}

/** Apply Unsharp Mask to a 1-D signal (channels 0..1): Gaussian-blur it (radius
 *  floored at 0.3), then sharpen each sample against its blurred value. A faithful
 *  1-D reference of the engine's per-channel sharpening. */
export function unsharpMask1D(
  signal: readonly number[],
  radius: number,
  amount: number,
  threshold: number,
): number[] {
  const blurred = convolve1D(signal, gaussianKernel(Math.max(radius, MIN_RADIUS)));
  return signal.map((o, i) => unsharpChannel(o, blurred[i], amount, threshold));
}
