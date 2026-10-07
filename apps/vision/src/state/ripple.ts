// ─────────────────────────────────────────────────────────────
// Ripple (Filter ▸ Distort ▸ Ripple) — wobble the image as if seen through water:
// each pixel is displaced by a sine wave, horizontally by a wave of its ROW and
// vertically by a wave of its COLUMN. A geometric warp reconstructed with bilinear
// interpolation; engine-free so it unit-tests in node, reusing Twirl's `sampleBilinear`
// (the engine's shared `sample_bi`).
//
// MUST match `mod.rs ripple_buf`:
//   s  = min(size, 2);  wl = [6, 14, 30][s];  amp = amount/100 · [3, 6, 12][s]   (px)
//   per pixel:  dx = amp · sin(τ·y / wl)   (depends on the row y)
//               dy = amp · sin(τ·x / wl)   (depends on the column x)
//               source = (x − dx, y − dy),   out = sample_bi(src, source)
// `amount = 0` (amp = 0) → source = (x, y) → the exact identity; the pixel at (0,0) is
// always identity (both sines are 0). Where the displacement pushes the source past the
// ±1 image border (|amp| > 1 near an edge), `sample_bi` returns 0 — ripple paints those
// edge pixels transparent/black, exactly like the engine.
//
// The geometry is f32 (`Math.fround`); JS `Math.sin` is f64 so `fround` of it is
// *approximately* the engine's f32 sin. Because the output is a bilinear blend rounded to
// nearest (not a nearest-neighbour pick), a ≤1 ULP coordinate difference shifts the result
// by ≤1 LSB. Mirrors the `twirl.ts` / `spherize.ts` house style.
// ─────────────────────────────────────────────────────────────

import { sampleBilinear } from "./twirl";

const fr = Math.fround;
/** `std::f32::consts::TAU` — the f32 nearest to 2π. */
const TAU = Math.fround(2 * Math.PI);
/** Per-size wavelength (px) and amplitude scale; index = clamped size 0/1/2. */
const WAVELENGTHS = [6, 14, 30] as const;
const AMP_SCALES = [3, 6, 12] as const;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const RIPPLE_MAX = 65535;

/** Clamp the `size` selector to the engine's `(size as usize).min(2)` (0 = Small …
 *  2 = Large); negatives and fractions truncate toward 0 then clamp into [0, 2]. */
function clampSize(size: number): 0 | 1 | 2 {
  const s = Math.trunc(size);
  return (s < 0 ? 0 : s > 2 ? 2 : s) as 0 | 1 | 2;
}

/** The wavelength (px) and amplitude (px) for a given `amount` (percent) and `size`:
 *  `wl = [6,14,30][s]`, `amp = amount/100 · [3,6,12][s]`. */
export function rippleParams(amount: number, size: number): { wl: number; amp: number } {
  const s = clampSize(size);
  return { wl: WAVELENGTHS[s], amp: fr(fr(fr(amount) / 100) * AMP_SCALES[s]) };
}

/** The source coordinate `(fx, fy)` that destination pixel `(x, y)` samples FROM: shift
 *  horizontally by `amp·sin(τ·y/wl)` (a wave of the row) and vertically by `amp·sin(τ·x/wl)`
 *  (a wave of the column); `source = (x − dx, y − dy)`. */
export function rippleSource(
  x: number,
  y: number,
  amount: number,
  size: number,
): { fx: number; fy: number } {
  const { wl, amp } = rippleParams(amount, size);
  const dx = fr(amp * fr(Math.sin(fr(fr(TAU * y) / wl))));
  const dy = fr(amp * fr(Math.sin(fr(fr(TAU * x) / wl))));
  return { fx: fr(x - dx), fy: fr(y - dy) };
}

/** Apply Ripple to a single-channel 2-D image (u16 values 0..65535): inverse-map each
 *  pixel through `rippleSource` and reconstruct it with `sampleBilinear`. `amount 0` is the
 *  exact identity. Run per channel to ripple an opaque RGB image, exactly as the engine
 *  does (source positions pushed off the image edge sample to 0). */
export function ripple2D(
  image: readonly (readonly number[])[],
  amount: number,
  size: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      const { fx, fy } = rippleSource(x, y, amount, size);
      row[x] = sampleBilinear(image, fx, fy);
    }
    out.push(row);
  }
  return out;
}
