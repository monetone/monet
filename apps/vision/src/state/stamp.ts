// ─────────────────────────────────────────────────────────────
// Stamp (Filter ▸ Sketch ▸ Stamp) — reduces the image to a crisp two-tone rubber-stamp: it
// smooths the luminance, thresholds it against `balance`, and paints the dark side with the
// foreground colour and the light side with the background colour. Deterministic; engine-free
// so it unit-tests in node.
//
// The threshold is driven by LUMINANCE (Rec.601 over R,G,B) and the output is a fg/bg colour,
// so this couples the channels — like Smart Blur, this reference models a single LUMINANCE
// channel: each value v is a grey pixel R=G=B=v, for which luminance reduces to the channel's
// own self-weighting `(v·0.299 + v·0.587 + v·0.114)/65535`, and `fg`/`bg` are that channel's
// 8-bit foreground/background values. On a grey image this matches `stamp` bit-for-bit.
//
// MUST match `filters.rs stamp` (grey domain, full selection ⇒ coverage 1 ⇒ straight replace):
//   thr = clamp(balance, 0, 1),   r = round(clamp(smoothness, 0, 1) · 8)   (0..8 px)
//   per pixel: smoothed = mean of lum over the (2r+1)² edge-clamped window
//   out = (smoothed < thr) ? fg·257 : bg·257          (dark → foreground, light → background)
//
// `r = 0` (smoothness 0) thresholds each pixel's own luminance with no pre-blur. The fg/bg
// 8-bit values are widened to 16-bit by `·257` (the engine's `to16`). The lum window is summed
// in f32 (≤289 values in [0,1], so well under 2²⁴ — no precision loss). Mirrors the
// `smartBlur.ts` / Rec.601 house style.
// ─────────────────────────────────────────────────────────────

import { roundHalfAway } from "./motionBlur";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const STAMP_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The smoothing box radius: `round(clamp(smoothness, 0, 1) · 8)`, i.e. 0..8 px. Exposed so
 *  the derivation is unit-testable on its own. */
export function stampRadius(smoothness: number): number {
  return roundHalfAway(fr(clamp01(fr(smoothness)) * 8));
}

/** The Stamp output for a single (grey/luminance) pixel `(x, y)`: the foreground value if its
 *  smoothed luminance is below `balance`, else the background value (both 8-bit, widened ·257).
 *  Exposed so the threshold/smoothing is testable independently. Precondition: `image`
 *  non-empty and `(x,y)` in bounds (`stamp2D` guarantees this). */
export function stampPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  balance: number,
  smoothness: number,
  fg: number,
  bg: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const thr = clamp01(fr(balance));
  const r = stampRadius(smoothness);
  let sum = 0;
  let cnt = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      sum = fr(sum + lum(image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)]));
      cnt += 1;
    }
  }
  const smoothed = fr(sum / cnt);
  return smoothed < thr ? fg * 257 : bg * 257; // dark → fg, light → bg; ·257 widens u8 → u16
}

/** Apply Stamp to a single-channel (luminance) 2-D image (u16 values 0..65535). `fg`/`bg` are
 *  the 8-bit foreground/background values for this channel. */
export function stamp2D(
  image: readonly (readonly number[])[],
  balance: number,
  smoothness: number,
  fg: number,
  bg: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = stampPixel(image, x, y, balance, smoothness, fg, bg);
    }
  }
  return out;
}
