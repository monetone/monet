// ─────────────────────────────────────────────────────────────
// Spherize (Filter ▸ Distort ▸ Spherize / Pinch) — wrap the image onto a sphere: a
// positive amount bulges the centre outward (fish-eye), a negative amount pinches it
// inward. Like Twirl it is a geometric warp reconstructed with bilinear interpolation,
// but the remap is purely RADIAL — each pixel samples along its own ray from the centre,
// at a power-law-scaled radius (no rotation). Engine-free so it unit-tests in node; it
// reuses Twirl's `sampleBilinear` (the engine's shared `sample_bi`).
//
// MUST match `mod.rs spherize_buf`:
//   cx = w/2,  cy = h/2,  r = max(min(cx, cy), 1)
//   per pixel:  dx = x + 0.5 − cx,  dy = y + 0.5 − cy,  d = √(dx²+dy²) / r
//   ONLY when 1e-4 < d < 1 (inside the lens, off the exact centre):
//     scale = d^(1+amount) / d = d^amount
//     source = (cx + dx·scale − 0.5,  cy + dy·scale − 0.5),   out = sample_bi(src, source)
//   otherwise (outside the lens, or the dead centre) the pixel is left UNCHANGED.
// `amount = 0` → scale = 1 → source = (x, y) → the exact identity. Because the source
// offset `(dx·scale, dy·scale)` is parallel to `(dx, dy)`, the warp never rotates — it
// only moves pixels along their radius: amount>0 pulls the source toward the centre
// (magnifying it), amount<0 pushes it outward (pinch).
//
// The `1e-4 < d < 1` branch is benign at its edges: at d=1, scale = 1 → source = (x,y) →
// identical to leaving the pixel unchanged; near d=0 the affected region is sub-pixel. The
// geometry is f32 (`Math.fround`, `Math.pow` ≈ Rust `powf`), and the bilinear output is a
// rounded blend, so any f32 coordinate difference shifts the result by ≤1 LSB. Mirrors the
// `twirl.ts` house style.
// ─────────────────────────────────────────────────────────────

import { sampleBilinear } from "./twirl";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const SPHERIZE_MAX = 65535;

/** The source coordinate `(fx, fy)` that destination pixel `(x, y)` samples FROM under a
 *  spherize of `amount`, or `null` when the pixel is outside the lens (`d ≥ 1`) or at the
 *  dead centre (`d ≤ 1e-4`) and is therefore left unchanged. */
export function spherizeSource(
  x: number,
  y: number,
  w: number,
  h: number,
  amount: number,
): { fx: number; fy: number } | null {
  const cx = fr(w / 2);
  const cy = fr(h / 2);
  const r = Math.max(Math.min(cx, cy), 1);
  const dx = fr(fr(x + 0.5) - cx);
  const dy = fr(fr(y + 0.5) - cy);
  const d = fr(fr(Math.sqrt(fr(fr(dx * dx) + fr(dy * dy)))) / r);
  // outside the lens (d ≥ 1) or the dead centre (d ≤ 1e-4) → unchanged. The 1e-4 cutoff is
  // f32-rounded to mirror the engine's f32 literal (the threshold is never actually straddled).
  if (!(d < 1 && d > fr(1e-4))) return null;
  const nd = fr(Math.pow(d, fr(1 + fr(amount))));
  const scale = fr(nd / d);
  const fx = fr(fr(cx + fr(dx * scale)) - 0.5);
  const fy = fr(fr(cy + fr(dy * scale)) - 0.5);
  return { fx, fy };
}

/** Apply Spherize to a single-channel 2-D image (u16 values 0..65535): inside the lens,
 *  inverse-map each pixel along its radius (`spherizeSource`) and reconstruct it with
 *  `sampleBilinear`; outside the lens the pixel is copied through. `amount 0` is the exact
 *  identity. Run per channel to spherize an opaque RGB image, exactly as the engine does. */
export function spherize2D(image: readonly (readonly number[])[], amount: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = spherizeSource(x, y, w, h, amount);
      if (src) out[y][x] = sampleBilinear(image, src.fx, src.fy);
    }
  }
  return out;
}

/** Pack the smart-filter (id 13) params: `[amount]`. */
export function packSpherizeParams(amount: number): number[] {
  return [amount];
}

/** Read the amount from smart-filter params (missing → 0), f32-rounded to mirror the
 *  engine's f32 parameter so a replay reproduces the same warp. */
export function unpackSpherizeParams(params: ArrayLike<number>): number {
  return params.length === 0 ? 0 : fr(params[0]);
}
