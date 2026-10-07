// ─────────────────────────────────────────────────────────────
// Wind (Filter ▸ Stylize ▸ Wind) — smears bright pixels into horizontal streaks, like wind
// blowing paint across the canvas. Each output pixel is the MAX of itself and the upwind
// source pixels faded by distance, so bright values bleed downwind into tapering streaks.
// Three methods — Wind (reach 10), Blast (reach 24), Stagger (reach 10 + odd rows shifted) —
// and a direction (`fromLeft`). Per-channel and deterministic (no RNG); engine-free so it
// unit-tests in node.
//
// MUST match `filters.rs wind` (applied per channel; this models one channel):
//   len = (method == 1) ? 24 : 10           // Blast reaches further
//   dir = fromLeft ? 1 : -1                  // sample upwind
//   per row y: stagger = (method == 2 && y odd) ? 2 : 0
//   per pixel x:
//     best = src[x]                          // k=0 (self), full strength
//     for k in 1..=len:
//       sx = x − dir·(k + stagger)
//       if sx ∈ [0, w):  faded = src[sx] · (1 − k/(len+1));  best = max(best, faded)
//       (sx OUT OF RANGE IS SKIPPED — not edge-clamped, not zero)
//     out = round(best)                      // f32::round, half away from zero
//
// Because `best` starts at the pixel itself and only ever grows, Wind never darkens a pixel
// (out ≥ in) and a flat field is unchanged (every faded neighbour is < the flat value). The
// fade factor `1 − k/(len+1)` is f32; `best.round()` with `best ≥ 0` is plain half-up.
// Mirrors the `motionBlur.ts` house style (directional streak, edge-skipped, f32 round).
// ─────────────────────────────────────────────────────────────

import { roundHalfAway } from "./motionBlur";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const WIND_MAX = 65535;
/** Method selectors (engine `method: u8`). */
export const WIND_WIND = 0;
export const WIND_BLAST = 1;
export const WIND_STAGGER = 2;

/** Streak reach for a method: Blast (1) reaches 24, Wind/Stagger reach 10. */
const streakLen = (method: number): number => (method === 1 ? 24 : 10);

/** The Wind output for a single pixel `(x, y)` of one channel: the max of the pixel and its
 *  distance-faded upwind neighbours along row `y`. Exposed so the streak is unit-testable
 *  independently of the full-image pass. Precondition: `image` non-empty, `(x, y)` in bounds
 *  (`wind2D` guarantees this). */
export function windPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  method: number,
  fromLeft: boolean,
): number {
  const row = image[y];
  const w = row.length;
  const len = streakLen(method);
  const dir = fromLeft ? 1 : -1;
  const stagger = method === 2 && (y & 1) === 1 ? 2 : 0;
  const lenP1 = fr(len + 1);
  let best = fr(row[x]); // k = 0 (self), full strength
  for (let k = 1; k <= len; k++) {
    const sx = x - dir * (k + stagger);
    if (sx < 0 || sx >= w) continue; // out of range upwind sample is skipped
    const fade = fr(1 - fr(fr(k) / lenP1));
    const faded = fr(row[sx] * fade);
    if (faded > best) best = faded;
  }
  return roundHalfAway(best);
}

/** Apply Wind to a single-channel 2-D image (u16 values 0..65535). Run per channel to streak
 *  an RGB image, exactly as the engine does (the streak is per-row and per-channel). */
export function wind2D(
  image: readonly (readonly number[])[],
  method: number,
  fromLeft: boolean,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = windPixel(image, x, y, method, fromLeft);
    }
  }
  return out;
}
