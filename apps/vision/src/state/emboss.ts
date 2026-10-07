// ─────────────────────────────────────────────────────────────
// Emboss (Filter ▸ Stylize ▸ Emboss) — turn the image into grey relief lit from a chosen
// angle: flat areas go mid-grey and edges become embossed ridges/grooves. Engine-free so
// it unit-tests in node; it reuses the `roundHalfAway` (Rust `f32::round`) from
// `motionBlur.ts`, since picking the neighbour is the same hard rounding decision.
//
// MUST match `filters.rs emboss`:
//   height = max(height, 1)                (Photoshop's Height = relief thickness in px)
//   dx = cos(angle°)·height,  dy = sin(angle°)·height   (f32)
//   per pixel:  sx = round(x + dx),  sy = round(y + dy)   (the neighbour `height` steps
//   along the angle, edge-clamped);  per channel  v = 32768 + (a − b)·amount   where a =
//   the pixel and b = that neighbour;  out = clamp(v, 0, 65535) as u16  (TRUNCATE).
// A flat neighbourhood (a = b) → 32768 (mid-grey); an edge facing the light is brighter,
// the opposite side darker.
//
// Two faithfulness notes (shared with Motion Blur):
//  • `f32::round` rounds half AWAY FROM ZERO, and it is NOT translation-invariant across a
//    sign change of the fractional part, so the neighbour is re-rounded `round(x + dx)`
//    PER PIXEL (a precomputed offset would diverge at oblique angles where dx/dy hit ±0.5).
//  • The trig is reproduced in f32, but JS `Math.cos/sin` are f64, so `fround` of them is
//    *approximately* — not always bit-equal to — Rust's f32 cos/sin; the chosen neighbour
//    is exact at the axis-aligned angles and agrees in practice elsewhere.
// The value is continuous (clamped only at write-out), so the only further divergence is
// the `as u16` truncation, ≤1 LSB. The dialog passes Angle (−360..360°), Height
// (1..100 px) and Amount (1..500% ÷ 100) straight through. Mirrors the
// `motionBlur.ts` / `highPass.ts` house style.
// ─────────────────────────────────────────────────────────────

import { roundHalfAway } from "./motionBlur";

const fr = Math.fround;
/** `angle.to_radians()` constant in f32: `PI / 180` evaluated as f32. */
const DEG2RAD = Math.fround(Math.fround(Math.PI) / 180);

/** The mid-grey the relief is centred on (the engine adds u16 32768). */
export const EMBOSS_MID = 32768;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const EMBOSS_MAX = 65535;

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clampU16 = (n: number): number => (n < 0 ? 0 : n > EMBOSS_MAX ? EMBOSS_MAX : n);

/** Photoshop's Height floor — the engine does `height.max(1.0)`, so a 0/absent
 *  Height still samples the neighbour one step away. */
export const EMBOSS_MIN_HEIGHT = 1;

/** The direction step `(dx, dy) = (cos, sin)·max(height, 1)` of the angle, evaluated
 *  in f32. `height` is the relief thickness in px (#147) — the engine scales the
 *  neighbour offset by it, so a Height of 5 reads 5px along the angle, not 1. */
export function embossDirection(angle: number, height = EMBOSS_MIN_HEIGHT): { dx: number; dy: number } {
  const rad = fr(fr(angle) * DEG2RAD);
  const hh = fr(Math.max(fr(height), EMBOSS_MIN_HEIGHT));
  return { dx: fr(fr(Math.cos(rad)) * hh), dy: fr(fr(Math.sin(rad)) * hh) };
}

/** The embossed value for one channel: `clamp(32768 + (a − b)·amount, 0, 65535)`,
 *  truncated. `a` is the pixel, `b` its direction-neighbour (both u16). */
export function embossValue(a: number, b: number, amount: number): number {
  const v = fr(EMBOSS_MID + fr(fr(a - b) * fr(amount)));
  return Math.trunc(clampU16(v));
}

/** Apply Emboss to a single-channel 2-D image (u16 values 0..65535): each pixel becomes
 *  `32768 + amount·(self − neighbour max(height,1) steps along `angle`)`, clamped. Flats →
 *  mid-grey, edges → relief. Run per channel to emboss an opaque RGB image, exactly as the
 *  engine does. The neighbour is re-rounded per pixel (`round(x + dx)`), matching the engine. */
export function emboss2D(
  image: readonly (readonly number[])[],
  angle: number,
  amount: number,
  height = EMBOSS_MIN_HEIGHT,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const { dx, dy } = embossDirection(angle, height);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      const sx = roundHalfAway(fr(x + dx));
      const sy = roundHalfAway(fr(y + dy));
      const a = image[y][x];
      const b = image[clampIdx(sy, h - 1)][clampIdx(sx, w - 1)];
      row[x] = embossValue(a, b, amount);
    }
    out.push(row);
  }
  return out;
}

/** Pack the smart-filter (id 6) params: `[angle, amount, height]` — the dispatcher
 *  reads `g(0), g(1), g(2)`, so dropping Height replayed every relief at 1px (#147). */
export function packEmbossParams(angle: number, amount: number, height = EMBOSS_MIN_HEIGHT): number[] {
  return [angle, amount, height];
}

/** Read smart-filter params back into `{ angle, amount, height }`, f32-rounded to mirror
 *  the engine's f32 parameters so a replay reproduces the same relief. A missing angle /
 *  amount reads 0 (the engine's `g` default); a missing Height reads 1, which is what the
 *  engine's `height.max(1.0)` makes of the same absent slot. */
export function unpackEmbossParams(
  params: ArrayLike<number>,
): { angle: number; amount: number; height: number } {
  const at = (i: number, dflt = 0): number => (i < params.length ? params[i] : dflt);
  return { angle: fr(at(0)), amount: fr(at(1)), height: fr(at(2, EMBOSS_MIN_HEIGHT)) };
}
