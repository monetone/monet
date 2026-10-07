// ─────────────────────────────────────────────────────────────
// Shear (Filter ▸ Distort ▸ Shear) — slide each row sideways by an offset that varies
// linearly from the top of the image to the bottom (a 2-point Photoshop shear curve). The
// strip left undefined on one side is either wrapped around from the other (`wrap`) or
// filled by repeating the edge column (clamp). A geometric warp reconstructed with bilinear
// interpolation; engine-free so it unit-tests in node, reusing Twirl's `sampleBilinear`.
//
// MUST match `mod.rs shear_buf`:
//   denom = max(h−1, 1)
//   per row y:  t = y/denom,  off = top + (bottom − top)·t   (px; top at row 0, bottom at h−1)
//   per pixel:  sx = x − off,  then  sx = wrap ? rem_euclid(sx, w) : clamp(sx, 0, w−1)
//   out = sample_bi(src, sx, y)            (y is integer → a horizontal-only resample)
// `top = bottom = 0` → off = 0 → source = (x, y) → the exact identity. Both modes keep `sx`
// in [0, w), so a constant image is invariant. An INTEGER offset gives an exact cyclic shift
// (wrap) or edge-repeat (clamp); a fractional offset blends horizontally, and at the wrap
// seam the bilinear taps edge-clamp (they do not blend across the wrap) — exactly like the
// engine's `sample_bi`.
//
// The geometry is f32 (`Math.fround`); the bilinear output is a rounded blend, so f32↔f64
// differences are ≤1 LSB. Mirrors the `twirl.ts` / `ripple.ts` house style.
// ─────────────────────────────────────────────────────────────

import { sampleBilinear } from "./twirl";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const SHEAR_MAX = 65535;

/** The horizontal offset (px) for output row `y` of an `h`-tall image: linear from `top`
 *  (row 0) to `bottom` (row h−1), via `t = y/max(h−1, 1)`. */
export function shearOffset(y: number, h: number, top: number, bottom: number): number {
  const denom = Math.max(h - 1, 1);
  const t = fr(y / denom);
  return fr(fr(top) + fr(fr(fr(bottom) - fr(top)) * t));
}

/** The least non-negative remainder `sx mod w` (Rust `f32::rem_euclid`), result in [0, w). */
function remEuclid(sx: number, w: number): number {
  const r = fr(sx % w);
  const e = r < 0 ? fr(r + w) : r;
  return e === 0 ? 0 : e; // normalise −0 (from a negative multiple of w) to +0
}

/** The source x for destination `(x, y)`: `x − off`, then wrapped into `[0, w)` (`wrap`) or
 *  clamped to `[0, w−1]` (repeat-edge). */
export function shearSourceX(x: number, off: number, w: number, wrap: boolean): number {
  const sx = fr(x - off);
  if (wrap) return remEuclid(sx, w);
  return sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx;
}

/** Apply Shear to a single-channel 2-D image (u16 values 0..65535): slide each row by its
 *  linear offset and resample horizontally with `sampleBilinear`; the row index `y` is
 *  unchanged. Run per channel to shear an opaque RGB image, exactly as the engine does. */
export function shear2D(
  image: readonly (readonly number[])[],
  top: number,
  bottom: number,
  wrap: boolean,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const off = shearOffset(y, h, top, bottom);
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      row[x] = sampleBilinear(image, shearSourceX(x, off, w, wrap), y);
    }
    out.push(row);
  }
  return out;
}
