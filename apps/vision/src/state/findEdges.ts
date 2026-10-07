// ─────────────────────────────────────────────────────────────
// Find Edges (Filter ▸ Stylize ▸ Find Edges) — outline the image's edges on a white
// field, like a pencil tracing. It is the opposite of a blur: flat regions go white and
// only gradients survive (dark). Engine-free so it unit-tests in node.
//
// MUST match `filters.rs find_edges`: per channel, take the Sobel gradient
//   gx = −[x−1,y−1] − 2[x−1,y] − [x−1,y+1] + [x+1,y−1] + 2[x+1,y] + [x+1,y+1]
//   gy = −[x−1,y−1] − 2[x,y−1] − [x+1,y−1] + [x−1,y+1] + 2[x,y+1] + [x+1,y+1]
// with edge-clamped coordinates (the engine's `idx`), then
//   mag = min(√(gx² + gy²), 65535),   out = (65535 − mag) as u16   (TRUNCATE, inverted).
// So a flat neighbourhood (gx = gy = 0) → 65535 (white), and a hard edge whose gradient
// saturates → 0 (black). Per channel, so colour edges keep their hue; on grayscale
// (r=g=b) the three channels match, giving a grey-on-white sketch.
//
// The Sobel sums are exact: each is an integer combination of u16 values bounded by
// 4·65535 = 262140 < 2²⁴, so f32 represents them exactly. Only `gx²`/`gy²` (which exceed
// 2²⁴) and the `sqrt` round in f32, and JS `Math.sqrt` is f64 — so the magnitude is
// reproduced in f32 (`Math.fround`) and the `as u16` truncation can shift the output by
// ≤1 LSB at an exact integer boundary (a flat → white region is exact). Mirrors the
// `boxBlur.ts` / `despeckle.ts` house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const FIND_EDGES_MAX = 65535;

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Sample `image[clamp(y)][clamp(x)]` with edge replication. */
const at = (image: readonly (readonly number[])[], x: number, y: number, w: number, h: number): number =>
  image[clampIdx(y, h - 1)][clampIdx(x, w - 1)];

/** The horizontal Sobel response at `(x, y)` (edge-clamped). Exact integer:
 *  right column (weights 1,2,1) minus left column. Positive on a dark→light edge. */
export function sobelGx(image: readonly (readonly number[])[], x: number, y: number): number {
  const w = image[0].length;
  const h = image.length;
  return (
    -at(image, x - 1, y - 1, w, h) -
    2 * at(image, x - 1, y, w, h) -
    at(image, x - 1, y + 1, w, h) +
    at(image, x + 1, y - 1, w, h) +
    2 * at(image, x + 1, y, w, h) +
    at(image, x + 1, y + 1, w, h)
  );
}

/** The vertical Sobel response at `(x, y)` (edge-clamped). Exact integer:
 *  bottom row (weights 1,2,1) minus top row. */
export function sobelGy(image: readonly (readonly number[])[], x: number, y: number): number {
  const w = image[0].length;
  const h = image.length;
  return (
    -at(image, x - 1, y - 1, w, h) -
    2 * at(image, x, y - 1, w, h) -
    at(image, x + 1, y - 1, w, h) +
    at(image, x - 1, y + 1, w, h) +
    2 * at(image, x, y + 1, w, h) +
    at(image, x + 1, y + 1, w, h)
  );
}

/** The edge magnitude `min(√(gx² + gy²), 65535)`, evaluated in f32 (the engine's path). */
export function edgeMagnitude(gx: number, gy: number): number {
  const mag = fr(Math.sqrt(fr(fr(gx * gx) + fr(gy * gy))));
  return mag > FIND_EDGES_MAX ? FIND_EDGES_MAX : mag;
}

/** Apply Find Edges to a single-channel 2-D image (u16 values 0..65535): each pixel
 *  becomes `65535 − min(√(gx²+gy²), 65535)`, truncated. Flat areas → white, edges →
 *  dark. Run per channel to outline an opaque RGB image, exactly as the engine does. */
export function findEdges2D(image: readonly (readonly number[])[]): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      const mag = edgeMagnitude(sobelGx(image, x, y), sobelGy(image, x, y));
      row[x] = Math.trunc(fr(FIND_EDGES_MAX - mag)); // 65535 − mag, inverted
    }
    out.push(row);
  }
  return out;
}
