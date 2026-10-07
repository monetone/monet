// ─────────────────────────────────────────────────────────────
// Glowing Edges (Filter ▸ Stylize ▸ Glowing Edges) — finds the edges of an image and lights
// them up like neon on a black background. For each pixel it measures the colour gradient
// across a span of `width` pixels, and the brighter the edge the brighter the glow; flat
// areas have no gradient and go black. Per-channel and deterministic; engine-free so it
// unit-tests in node.
//
// MUST match `filters.rs glowing_edges` (applied per channel; this models one channel):
//   d = max(width, 1)
//   per pixel (x,y):  gx = src[x+d,y] − src[x−d,y],  gy = src[x,y+d] − src[x,y−d]
//     (both sampled with `idx`, which EDGE-CLAMPS x,y to the image)
//   mag = sqrt(gx² + gy²) · brightness
//   out = clamp(mag, 0, 65535) as u16          (TRUNCATES — `as u16`, not rounded)
//
// Because the gradient of a flat region is 0, a flat image becomes solid BLACK (only edges
// survive) — unlike a blur/stylize that leaves flats intact. `brightness` scales the edge
// magnitude linearly before the clamp. The gradient is a central difference at span d, so a
// step edge lights a band of width 2d straddling it.
//
// f32 throughout (`Math.fround`) in the engine's order: gx² and gy² are f32 (and lose
// precision above 2²⁴, exactly as the engine does), summed, square-rooted, scaled, then
// truncated. Mirrors the `findEdges.ts` / `emboss.ts` house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const GLOWING_EDGES_MAX = 65535;

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The Glowing-Edges output for a single pixel `(x, y)` of one channel: the central-
 *  difference gradient magnitude across span `d = max(width,1)`, scaled by `brightness`,
 *  clamped and truncated to u16. Exposed so the gradient is unit-testable independently of
 *  the full-image pass. Precondition: `image` non-empty and `(x,y)` in bounds (`glowingEdges2D`
 *  guarantees this). */
export function glowingEdgesPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  width: number,
  brightness: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const d = Math.max(Math.trunc(width), 1);
  const bF = fr(brightness);
  const gx = fr(image[y][clampIdx(x + d, w - 1)] - image[y][clampIdx(x - d, w - 1)]);
  const gy = fr(image[clampIdx(y + d, h - 1)][x] - image[clampIdx(y - d, h - 1)][x]);
  const mag = fr(fr(Math.sqrt(fr(fr(gx * gx) + fr(gy * gy)))) * bF);
  const c = mag < 0 ? 0 : mag > GLOWING_EDGES_MAX ? GLOWING_EDGES_MAX : mag;
  return Math.trunc(c); // engine `as u16` truncates toward zero (mag ≥ 0)
}

/** Apply Glowing Edges to a single-channel 2-D image (u16 values 0..65535). Run per channel
 *  to glow an RGB image, exactly as the engine does (each channel's gradient is independent). */
export function glowingEdges2D(
  image: readonly (readonly number[])[],
  width: number,
  brightness: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = glowingEdgesPixel(image, x, y, width, brightness);
    }
  }
  return out;
}
