// ─────────────────────────────────────────────────────────────
// Polar Coordinates (Filter ▸ Distort ▸ Polar Coordinates) — remap between rectangular
// and polar space. Rectangular→Polar wraps the image into a disc (its Y becomes the
// radius from centre, its X the angle); Polar→Rectangular does the inverse. A geometric
// warp reconstructed with bilinear interpolation; engine-free so it unit-tests in node,
// reusing Twirl's `sampleBilinear` (the engine's shared `sample_bi`).
//
// MUST match `mod.rs polar_buf`:
//   cx = w/2, cy = h/2,  max_r = max(√(cx²+cy²), 1) (half-diagonal),  two_pi = TAU
//   per pixel, with xf = x+0.5, yf = y+0.5:
//   • Rectangular→Polar (toPolar):  dx = xf−cx, dy = yf−cy, r = √(dx²+dy²),
//       θ = atan2(dx, −dy)  (0 at the top, clockwise; += 2π if negative),
//       sxc = θ/2π · w  (source column = angle),  syc = r/max_r · h  (source row = radius)
//   • Polar→Rectangular:  angle = xf/w · 2π,  r = yf/h · max_r,
//       sxc = cx + r·sin(angle),  syc = cy − r·cos(angle)
//   then  source = (sxc − 0.5, syc − 0.5),  out = sample_bi(src, source).
// Rectangular→Polar keeps every source inside the image (r < max_r), so a constant image
// is invariant; Polar→Rectangular reaches `r = max_r` at the corners of the disc, which
// can land past the image edge → `sample_bi` returns 0 (those output pixels go black).
//
// The geometry is f32 (`Math.fround`, `Math.atan2/sin/cos/sqrt` ≈ Rust f32). Because the
// output is a rounded bilinear blend, a ≤1 ULP coordinate difference shifts the result by
// ≤1 LSB. Mirrors the `twirl.ts` / `ripple.ts` house style.
// ─────────────────────────────────────────────────────────────

import { sampleBilinear } from "./twirl";

const fr = Math.fround;
/** `std::f32::consts::TAU` — the f32 nearest to 2π. */
const TAU = Math.fround(2 * Math.PI);
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const POLAR_MAX = 65535;

/** The half-diagonal `max(√(cx²+cy²), 1)` used to normalise the radius (f32). */
export function polarMaxRadius(w: number, h: number): number {
  const cx = fr(w / 2);
  const cy = fr(h / 2);
  return Math.max(fr(Math.sqrt(fr(fr(cx * cx) + fr(cy * cy)))), 1);
}

/** The source coordinate `(fx, fy)` that destination pixel `(x, y)` samples FROM.
 *  `toPolar = true` wraps rectangular→polar (column=angle, row=radius); `false` does the
 *  inverse polar→rectangular. */
export function polarSource(
  x: number,
  y: number,
  w: number,
  h: number,
  toPolar: boolean,
): { fx: number; fy: number } {
  const cx = fr(w / 2);
  const cy = fr(h / 2);
  const wf = fr(w);
  const hf = fr(h);
  const maxR = polarMaxRadius(w, h);
  const xf = fr(x + 0.5);
  const yf = fr(y + 0.5);
  let sxc: number;
  let syc: number;
  if (toPolar) {
    const dx = fr(xf - cx);
    const dy = fr(yf - cy);
    const r = fr(Math.sqrt(fr(fr(dx * dx) + fr(dy * dy))));
    let theta = fr(Math.atan2(dx, fr(-dy))); // 0 at the top, clockwise
    if (theta < 0) theta = fr(theta + TAU);
    sxc = fr(fr(theta / TAU) * wf);
    syc = fr(fr(r / maxR) * hf);
  } else {
    const angle = fr(fr(xf / wf) * TAU);
    const r = fr(fr(yf / hf) * maxR);
    sxc = fr(cx + fr(r * fr(Math.sin(angle))));
    syc = fr(cy - fr(r * fr(Math.cos(angle))));
  }
  return { fx: fr(sxc - 0.5), fy: fr(syc - 0.5) };
}

/** Apply Polar Coordinates to a single-channel 2-D image (u16 values 0..65535):
 *  inverse-map each pixel through `polarSource` and reconstruct it with `sampleBilinear`.
 *  Run per channel to remap an opaque RGB image, exactly as the engine does (source
 *  positions pushed off the image edge sample to 0). */
export function polar2D(image: readonly (readonly number[])[], toPolar: boolean): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      const { fx, fy } = polarSource(x, y, w, h, toPolar);
      row[x] = sampleBilinear(image, fx, fy);
    }
    out.push(row);
  }
  return out;
}
