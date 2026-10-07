// ─────────────────────────────────────────────────────────────
// Poster Edges (Filter ▸ Artistic ▸ Poster Edges) — gives a silk-screened / comic-book look:
// it POSTERIZES the colour to a few flat tiers and then DARKENS the edges, inking black
// outlines where the image has strong local contrast. Deterministic; engine-free so it
// unit-tests in node.
//
// The edge term is driven by LUMINANCE (Rec.601 over R,G,B), which couples the channels, so —
// like Smart Blur — this reference models a single LUMINANCE channel: it treats each value v
// as a grey pixel R=G=B=v, for which luminance reduces to the channel's own self-weighting
// `(v·0.299 + v·0.587 + v·0.114)/65535`. On a grey image that matches `poster_edges` bit-for-
// bit; on colour input the engine's edge term would also weigh the other channels.
//
// MUST match `filters.rs poster_edges` (grey domain):
//   lv = max(levels, 2) − 1,   r = max(thickness, 1)
//   per pixel c, lc = lum(c).  maxd = max over the (2r+1)² edge-clamped neighbourhood of
//     |lum(n) − lc|   (the local contrast / edge strength)
//   dark = 1 − clamp(maxd · intensity, 0, 1)        (strong edge → dark → 0 = black)
//   q = round(v/65535 · lv) / lv                    (posterise to lv+1 tiers; f32::round)
//   out = to16(clamp(q · dark, 0, 1))               (round-half-up via to16)
//
// A flat region has maxd = 0 ⇒ dark = 1 ⇒ the pixel is purely posterised; a hard edge drives
// dark toward 0 ⇒ a black outline. `levels = 2` collapses to pure black/white. f32 throughout
// (`Math.fround`) in the engine's order. Mirrors the `smartBlur.ts` / Rec.601 house style.
// ─────────────────────────────────────────────────────────────

import { roundHalfAway } from "./motionBlur";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const POSTER_EDGES_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);

/** `color.rs to16`: clamp to [0,1], scale to 16-bit, round half up (`+0.5` then truncate). */
const to16 = (x: number): number => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return Math.trunc(fr(fr(c * 65535) + 0.5));
};

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Posterise one channel value to `lv+1 = max(levels,2)` tiers (the flat-region output, i.e.
 *  with no edge darkening). Exposed so the quantisation is unit-testable on its own. */
export function posterizeChannel(v: number, levels: number): number {
  const lv = fr(Math.max(Math.trunc(levels), 2) - 1);
  const q = fr(roundHalfAway(fr(fr(v / 65535) * lv)) / lv);
  return to16(q);
}

/** The Poster-Edges output for a single pixel `(x, y)` of one (grey/luminance) channel:
 *  the posterised value darkened by the local edge strength. Exposed so the edge term and
 *  posterisation are testable together. Precondition: `image` non-empty and `(x,y)` in bounds
 *  (`posterEdges2D` guarantees this). */
export function posterEdgesPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  levels: number,
  thickness: number,
  intensity: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const lv = fr(Math.max(Math.trunc(levels), 2) - 1);
  const r = Math.max(Math.trunc(thickness), 1);
  const intensityF = fr(intensity);
  const lc = lum(image[y][x]);
  let maxd = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nv = image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)];
      const d = Math.abs(fr(lum(nv) - lc));
      if (d > maxd) maxd = d;
    }
  }
  const md = fr(maxd * intensityF);
  const clamped = md < 0 ? 0 : md > 1 ? 1 : md;
  const dark = fr(1 - clamped);
  const q = fr(roundHalfAway(fr(fr(image[y][x] / 65535) * lv)) / lv);
  return to16(fr(q * dark));
}

/** Apply Poster Edges to a single-channel (luminance) 2-D image (u16 values 0..65535). */
export function posterEdges2D(
  image: readonly (readonly number[])[],
  levels: number,
  thickness: number,
  intensity: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = posterEdgesPixel(image, x, y, levels, thickness, intensity);
    }
  }
  return out;
}
