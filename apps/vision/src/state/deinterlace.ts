// ─────────────────────────────────────────────────────────────
// De-Interlace (Filter ▸ Video ▸ De-Interlace) — removes the interlacing combing artefacts of
// video frames by throwing away one field (the odd or the even scanlines) and rebuilding it,
// either by DUPLICATING the line above or by INTERPOLATING (averaging the lines above and
// below). Integer-only and deterministic; engine-free so it unit-tests in node.
//
// MUST match `filters.rs deinterlace` (applied per channel; this models one channel):
//   for each row y:  elim = eliminateOdd ? (y odd) : (y even)
//     if !elim → the row is left untouched
//     else, per pixel x (with `idx` EDGE-CLAMPING y±1 to the image):
//       interpolate ? out = (src[x, y−1] + src[x, y+1]) / 2   (u32 add, integer / truncates)
//                   : out = src[x, y−1]                        (duplicate the line above)
//
// The kept field is preserved exactly; only the eliminated field changes. At the top/bottom
// border `y−1`/`y+1` clamp to the same row, so a duplicated top row copies itself (unchanged)
// and an interpolated border row averages itself with its one real neighbour. Per channel and
// integer-exact. Mirrors the `despeckle.ts` / row-wise house style.
// ─────────────────────────────────────────────────────────────

/** The engine works in 16-bit; channel values span [0, 65535]. */
export const DEINTERLACE_MAX = 65535;

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Whether row `y` is eliminated (and thus rebuilt) for the chosen field. Exposed so the
 *  odd/even field selection is unit-testable on its own. */
export function isEliminatedRow(y: number, eliminateOdd: boolean): boolean {
  return eliminateOdd ? y % 2 === 1 : y % 2 === 0;
}

/** Apply De-Interlace to a single-channel 2-D image (u16 values 0..65535). Run per channel to
 *  de-interlace an RGB(A) image, exactly as the engine does (each channel is independent). */
export function deinterlace2D(
  image: readonly (readonly number[])[],
  eliminateOdd: boolean,
  interpolate: boolean,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    if (!isEliminatedRow(y, eliminateOdd)) continue; // kept field: row preserved exactly
    const above = image[clampIdx(y - 1, h - 1)];
    const below = image[clampIdx(y + 1, h - 1)];
    for (let x = 0; x < w; x++) {
      out[y][x] = interpolate ? Math.floor((above[x] + below[x]) / 2) : above[x];
    }
  }
  return out;
}
