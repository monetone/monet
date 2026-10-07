// ─────────────────────────────────────────────────────────────
// Trace Contour (Filter ▸ Stylize ▸ Trace Contour) — outline, per channel, where the
// image crosses a brightness `level` (like the contour lines on a map). The result is a
// 1-bit black-on-white sketch: a pixel is inked black if it sits on the chosen side of the
// level and a 4-connected neighbour sits on the other side (a level crossing touches it).
// Engine-free so it unit-tests in node — and unlike the blur/distort filters this is PURE
// INTEGER math (u16 comparisons), so it mirrors the engine bit-for-bit with no f32 caveat.
//
// MUST match `filters.rs trace_contour`: with `lv = level·257` (8-bit level → 16-bit),
// for each channel value `c`:
//   c_above = c ≥ lv;  on_side = upper ? c_above : !c_above
//   contour = on_side AND any of the 4 edge-clamped neighbours `n` has `(n ≥ lv) ≠ c_above`
//   out = contour ? 0 (black) : 65535 (white)
// `upper` selects which side of the level carries the line: `true` inks the high side of a
// crossing, `false` the low side. A flat region (no crossing) is all white; alpha is
// untouched. Mirrors the `findEdges.ts` / `despeckle.ts` state-module house style.
// ─────────────────────────────────────────────────────────────

/** 8-bit level → 16-bit threshold scale (`v8 · 257 = v16`). */
export const LEVEL_SCALE = 257;
/** Output values: black on a traced contour, white elsewhere. */
export const CONTOUR = 0;
export const FLAT = 65535;

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The 16-bit level threshold for an 8-bit `level` (0..255): `level · 257`. */
export function contourLevel(level8: number): number {
  return level8 * LEVEL_SCALE;
}

/** True if pixel `(x, y)` lies on a traced contour for threshold `lv` (16-bit) and side
 *  `upper`: it is on the selected side of the level AND at least one 4-connected,
 *  edge-clamped neighbour is on the opposite side. Single channel, integer-exact.
 *  Precondition: a non-empty image with `(x, y)` in bounds (callers like `traceContour2D`
 *  guard this). */
export function isContour(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  lv: number,
  upper: boolean,
): boolean {
  const h = image.length;
  const w = image[0].length;
  const cAbove = image[y][x] >= lv;
  const onSide = upper ? cAbove : !cAbove;
  if (!onSide) return false;
  const neighbours: [number, number][] = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
  for (const [nx, ny] of neighbours) {
    const n = image[clampIdx(ny, h - 1)][clampIdx(nx, w - 1)];
    if (n >= lv !== cAbove) return true; // a level crossing touches this pixel
  }
  return false;
}

/** Apply Trace Contour to a single-channel 2-D image (u16 values 0..65535): each pixel
 *  becomes 0 (black, on a contour) or 65535 (white). `level` is 0..255; `upper` picks the
 *  side of the level. Run per channel to trace an RGB image, exactly as the engine does. */
export function traceContour2D(
  image: readonly (readonly number[])[],
  level8: number,
  upper: boolean,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const lv = contourLevel(level8);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) row[x] = isContour(image, x, y, lv, upper) ? CONTOUR : FLAT;
    out.push(row);
  }
  return out;
}
