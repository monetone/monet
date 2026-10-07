// ─────────────────────────────────────────────────────────────
// Cutout (Filter ▸ Artistic ▸ Cutout) — portrays the image as though built from a few pieces
// of coloured paper: it box-SMOOTHS the image to merge nearby detail into flat regions, then
// QUANTIZES each channel to a handful of tiers. Per-channel and deterministic; engine-free so
// it unit-tests in node.
//
// MUST match `filters.rs cutout` (applied per channel; this models one channel):
//   lv = clamp(levels, 2, 8) − 1
//   r  = round( clamp(edgeSimplicity,0,10) · (4 − clamp(edgeFidelity,1,3)) / 3 ) clamped to [0,8]
//        (more simplicity → larger box; higher fidelity → smaller box / sharper edges)
//   per pixel/channel:  avg = mean of the (2r+1)² edge-clamped neighbourhood (f32 SUM)
//     q = round( avg/65535 · lv ) / lv          (f32::round; quantise the smoothed value)
//     out = to16(clamp(q, 0, 1))                (round-half-up via to16)
//
// The box sum is accumulated in f32 like the engine (`fr(sum + v)` per step): a 17×17 box
// (r=8) of bright pixels can exceed 2²⁴ and lose precision, which this mirror reproduces in
// the same order. (That precision difference is unobservable at the OUTPUT, though — after the
// ÷n average and the coarse ÷lv quantiser, an f64 accumulation yields the same tiers — so the
// f32 sum is faithful-by-construction, not something a golden can isolate.) r = 0 (low
// simplicity) means no smoothing → pure posterisation; a flat image becomes one uniform tier.
// Reuses `to16` / `roundHalfAway`; mirrors the `boxBlur.ts` / `posterEdges.ts` house style.
// ─────────────────────────────────────────────────────────────

import { roundHalfAway } from "./motionBlur";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const CUTOUT_MAX = 65535;

/** `color.rs to16`: clamp to [0,1], scale to 16-bit, round half up (`+0.5` then truncate). */
const to16 = (x: number): number => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return Math.trunc(fr(fr(c * 65535) + 0.5));
};

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The box radius for Cutout's smoothing pass, derived from Edge Simplicity (0..10) and Edge
 *  Fidelity (1..3): `round(simplicity·(4−fidelity)/3)` clamped to [0,8]. Exposed so the
 *  derivation is unit-testable on its own. */
export function cutoutRadius(edgeSimplicity: number, edgeFidelity: number): number {
  const es = Math.min(Math.max(Math.trunc(edgeSimplicity), 0), 10);
  const ef = Math.min(Math.max(Math.trunc(edgeFidelity), 1), 3);
  const prod = es * (4 - ef);
  return Math.min(Math.max(roundHalfAway(fr(prod / 3)), 0), 8);
}

/** The Cutout output for a single pixel `(x, y)` of one channel: the box-averaged value
 *  (radius `radius`) quantised to `levels` tiers. Exposed so the smoothing+quantise is
 *  testable independently. Precondition: `image` non-empty and `(x,y)` in bounds. */
export function cutoutPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  levels: number,
  radius: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const lv = fr(Math.min(Math.max(Math.trunc(levels), 2), 8) - 1);
  let sum = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      sum = fr(sum + image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)]); // f32 accumulation
      n += 1;
    }
  }
  const avg = fr(sum / n);
  const c = fr(fr(avg / 65535) * lv);
  const q = fr(roundHalfAway(c) / lv);
  return to16(q);
}

/** Apply Cutout to a single-channel 2-D image (u16 values 0..65535). Run per channel to cut
 *  out an RGB image, exactly as the engine does (each channel is smoothed & quantised alone). */
export function cutout2D(
  image: readonly (readonly number[])[],
  levels: number,
  edgeSimplicity: number,
  edgeFidelity: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  const radius = cutoutRadius(edgeSimplicity, edgeFidelity);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = cutoutPixel(image, x, y, levels, radius);
    }
  }
  return out;
}
