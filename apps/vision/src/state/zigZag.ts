// ─────────────────────────────────────────────────────────────
// ZigZag (Filter ▸ Distort ▸ ZigZag) — concentric sine waves rippling out from the
// centre, like a stone dropped in a pond. `ridges` sets how many wave crests span the
// radius; `style` chooses how each crest displaces a pixel: 0 Around Center (rotate the
// angle, radius fixed — a swirl), 1 Out From Center (push the radius, angle fixed — pure
// radial), 2 Pond Ripples (both). A geometric warp reconstructed with bilinear
// interpolation; engine-free so it unit-tests in node, reusing Twirl's `sampleBilinear`.
//
// MUST match `mod.rs zigzag_buf`:
//   cx = w/2, cy = h/2, max_r = max(√(cx²+cy²), 1),  amp = amount/100 · 6 (px), rg = max(ridges,1)
//   per pixel, dx = x+0.5−cx, dy = y+0.5−cy, r = √(dx²+dy²):
//     r < 1e-3 → leave the pixel unchanged (the dead centre).
//     s = sin(τ·rg·r/max_r),  θ = atan2(dy, dx)
//     style 0: nr = r,            ang = θ + amp/r · s         (radius preserved → rotation)
//     style 1: nr = r + amp·s,    ang = θ                     (angle preserved → radial)
//     else   : nr = r + amp·s·0.7, ang = θ + amp/r·s·0.5      (both)
//     source = (cx + nr·cos(ang) − 0.5,  cy + nr·sin(ang) − 0.5),  out = sample_bi(src, source)
// At `amount = 0` (amp = 0) every style reduces to `nr=r, ang=θ`, i.e. the source ≈ (x, y) —
// but the engine still resamples through atan2/cos/sin, so a constant image is exact while a
// textured one is the identity only approximately: the f32 round-trip error scales with the
// radius (sub-LSB on small images, a few LSB at the corners of large high-contrast content),
// and the engine diverges identically. Any style can push the source past the image edge
// (radius displaced for styles 1/2, or rotated off the rectangle for style 0) → `sample_bi`
// returns 0 (black) there.
//
// The geometry is f32 (`Math.fround`); the bilinear output is a rounded blend, so f32↔f64
// differences are ≤1 LSB. Mirrors the `twirl.ts` / `ripple.ts` house style.
// ─────────────────────────────────────────────────────────────

import { sampleBilinear } from "./twirl";

const fr = Math.fround;
/** `std::f32::consts::TAU` — the f32 nearest to 2π. */
const TAU = Math.fround(2 * Math.PI);
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const ZIGZAG_MAX = 65535;
/** Below this radius the pixel is the dead centre and left unchanged (engine `r < 1e-3`). */
const CENTER_EPS = Math.fround(1e-3);

/** The source coordinate `(fx, fy)` destination pixel `(x, y)` samples FROM under a zigzag
 *  of `amount`/`ridges`/`style`, or `null` when the pixel is the dead centre (`r < 1e-3`)
 *  and is left unchanged. */
export function zigzagSource(
  x: number,
  y: number,
  w: number,
  h: number,
  amount: number,
  ridges: number,
  style: number,
): { fx: number; fy: number } | null {
  const cx = fr(w / 2);
  const cy = fr(h / 2);
  const maxR = Math.max(fr(Math.sqrt(fr(fr(cx * cx) + fr(cy * cy)))), 1);
  const amp = fr(fr(fr(amount) / 100) * 6);
  const rg = Math.max(Math.trunc(ridges), 1);
  const dx = fr(fr(x + 0.5) - cx);
  const dy = fr(fr(y + 0.5) - cy);
  const r = fr(Math.sqrt(fr(fr(dx * dx) + fr(dy * dy))));
  if (r < CENTER_EPS) return null;
  const s = fr(Math.sin(fr(fr(fr(TAU * rg) * r) / maxR)));
  const theta = fr(Math.atan2(dy, dx));
  let nr: number;
  let ang: number;
  if (style === 0) {
    nr = r;
    ang = fr(theta + fr(fr(amp / r) * s));
  } else if (style === 1) {
    nr = fr(r + fr(amp * s));
    ang = theta;
  } else {
    nr = fr(r + fr(fr(amp * s) * 0.7));
    ang = fr(theta + fr(fr(fr(amp / r) * s) * 0.5));
  }
  const sxc = fr(cx + fr(nr * fr(Math.cos(ang))));
  const syc = fr(cy + fr(nr * fr(Math.sin(ang))));
  return { fx: fr(sxc - 0.5), fy: fr(syc - 0.5) };
}

/** Apply ZigZag to a single-channel 2-D image (u16 values 0..65535): inverse-map each
 *  pixel through `zigzagSource` and reconstruct it with `sampleBilinear`; the dead-centre
 *  pixel is copied through. Run per channel to ripple an opaque RGB image, exactly as the
 *  engine does (source positions pushed off the image edge sample to 0). */
export function zigZag2D(
  image: readonly (readonly number[])[],
  amount: number,
  ridges: number,
  style: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = zigzagSource(x, y, w, h, amount, ridges, style);
      if (src) out[y][x] = sampleBilinear(image, src.fx, src.fy);
    }
  }
  return out;
}
