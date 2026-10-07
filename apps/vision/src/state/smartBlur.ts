// ─────────────────────────────────────────────────────────────
// Smart Blur (Filter ▸ Blur ▸ Smart Blur) — an edge-PRESERVING blur: each pixel averages
// only the neighbours within a luminance `threshold` of it, so flat regions smooth out
// while edges stay crisp. Three modes: Normal (the gated blur), Edge Only (white edges on
// black), and Overlay Edge (white edges painted over the blur). Engine-free so it
// unit-tests in node.
//
// The engine's gate is driven by LUMINANCE (Rec.601 over R,G,B), which couples the channels,
// so — unlike the per-channel blurs — this reference models a single LUMINANCE channel: it
// treats each `number` as a grey pixel R=G=B=v, for which luminance reduces to the channel's
// own Rec.601 self-weighting `(v·0.299 + v·0.587 + v·0.114)/65535`. On a grey (R=G=B) image
// that is exactly what the engine computes for every channel, so this matches `smart_blur`'s
// output bit-for-bit; on a colour image the engine's gate would also weigh the other channels.
//
// MUST match `filters.rs smart_blur` (opaque/grey domain ⇒ premultiply alpha = 1):
//   r = max(radius, 1),  thr = clamp(threshold/255, 0, 1)
//   per pixel c, lc = lum(c).  Over the (2r+1)² edge-clamped neighbourhood:
//     d = |lum(n) − lc|;  max_diff = max d;  if d ≤ thr → include n (sum v/65535, count++)
//   is_edge = max_diff > thr   (the centre is always included: d=0 ≤ thr, so count ≥ 1)
//   Normal  : to16(mean of the included v/65535)         (round-half-up via to16)
//   EdgeOnly: is_edge ? 65535 : 0
//   Overlay : is_edge ? 65535 : Normal
//
// f32 throughout (`Math.fround`) in the engine's evaluation order; `to16(x) =
// trunc(clamp(x,0,1)·65535 + 0.5)`. Mirrors the `boxBlur.ts` / Rec.601 house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const SMART_BLUR_MAX = 65535;
/** Mode selectors (engine `mode: u8`). */
export const SMART_NORMAL = 0;
export const SMART_EDGE_ONLY = 1;
export const SMART_OVERLAY = 2;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], computed in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);

/** `color.rs to16`: clamp to [0,1], scale to 16-bit, round half up (`+0.5` then truncate). */
const to16 = (x: number): number => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return Math.trunc(fr(fr(c * 65535) + 0.5));
};

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Classify one pixel: `isEdge` (a neighbour exceeds the luminance threshold) and `value`
 *  (its Normal-mode threshold-gated mean). Exposed so the gate/edge logic is unit-testable
 *  independently of the mode dispatch. Precondition: `image` is non-empty and `(x, y)` is in
 *  bounds — `smartBlur2D` guarantees this; calling it on an empty image is undefined. */
export function smartBlurPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  radius: number,
  threshold: number,
): { isEdge: boolean; value: number } {
  const h = image.length;
  const w = image[0].length;
  const r = Math.max(Math.trunc(radius), 1);
  const thr = (() => {
    const t = fr(fr(threshold) / 255);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  })();
  const lc = lum(image[y][x]);
  let acc = 0;
  let wsum = 0;
  let maxDiff = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = clampIdx(x + dx, w - 1);
      const ny = clampIdx(y + dy, h - 1);
      const vn = image[ny][nx];
      const d = Math.abs(fr(lum(vn) - lc));
      if (d > maxDiff) maxDiff = d;
      if (d <= thr) {
        acc = fr(acc + fr(vn / 65535)); // premultiplied alpha = 1 (opaque/grey)
        wsum = fr(wsum + 1);
      }
    }
  }
  const isEdge = maxDiff > thr;
  // Normal value: mean over the gate, with the engine's premult-normalise (alpha ≡ 1 here).
  const wsumMax = Math.max(wsum, 1);
  const aNorm = fr(wsum / wsumMax);
  const value = aNorm > 1e-4 ? to16(fr(fr(acc / wsumMax) / aNorm)) : image[y][x];
  return { isEdge, value };
}

/** Apply Smart Blur to a single-channel (luminance) 2-D image (u16 values 0..65535). */
export function smartBlur2D(
  image: readonly (readonly number[])[],
  radius: number,
  threshold: number,
  mode: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { isEdge, value } = smartBlurPixel(image, x, y, radius, threshold);
      if (mode === SMART_EDGE_ONLY) out[y][x] = isEdge ? SMART_BLUR_MAX : 0;
      else if (mode === SMART_OVERLAY) out[y][x] = isEdge ? SMART_BLUR_MAX : value;
      else out[y][x] = value;
    }
  }
  return out;
}
