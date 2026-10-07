// ─────────────────────────────────────────────────────────────
// Accented Edges (Filter ▸ Brush Strokes ▸ Accented Edges) — finds edges (a Sobel gradient of the
// luminance) and pushes them toward an "edge colour": bright edge_color accents edges like white
// chalk, dark accents them like ink. Flat areas (no gradient) are left untouched. Deterministic;
// engine-free so it unit-tests in node.
//
// The edge strength is a LUMINANCE gradient (Rec.601 over R,G,B, on the RAW 16-bit values — NOT
// divided by 65535); the push is per channel toward the shared edge_color. On a grey image
// (R=G=B=v) this matches `accented_edges` bit-for-bit — modelled here as one channel.
//
// MUST match `filters.rs accented_edges` (grey domain, full selection ⇒ cov 1):
//   gain = 1 + 6·clamp(width,0,1);  thresh = 4000 + 30000·clamp(smoothness,0,1)
//   edge_color = clamp(brightness,0,1)·65535
//   luma(v) = v·0.299 + v·0.587 + v·0.114        (RAW; edge-clamped 3×3 neighbourhood)
//   gx = Sobel-x of luma;  gy = Sobel-y of luma;  mag = sqrt(gx² + gy²)
//   edge = clamp(mag/thresh·gain, 0, 1)
//   out  = clamp(v + (edge_color − v)·edge, 0, 65535) as u16    (TRUNCATES)
//
// Fully bit-exact: the only non-elementary op is `sqrt`, which is IEEE-correctly-rounded, so
// `fround(Math.sqrt(x))` equals the engine's `f32::sqrt(x)` (double-rounding theorem); every other
// op is + − × ÷ or clamp. `Math.fround` per sub-op reproduces the engine's f32 order. A flat field
// has zero gradient ⇒ edge 0 ⇒ identity; a strong edge saturates edge to 1 ⇒ the pixel becomes
// edge_color.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const ACCENTED_EDGES_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** RAW luminance of a grey pixel `v` (R=G=B=v): `v·C_R + v·C_G + v·C_B` (NOT divided by 65535),
 *  in the engine's f32 order. */
const luma = (v: number): number => fr(fr(fr(C_R * v) + fr(C_G * v)) + fr(C_B * v));

/** Edge gain `1 + 6·clamp(width,0,1)` (1..7). Exposed for testing. */
export function accentedEdgesGain(width: number): number {
  return fr(1 + fr(6 * clamp01(fr(width))));
}
/** Edge threshold `4000 + 30000·clamp(smoothness,0,1)` (4000..34000). Exposed for testing. */
export function accentedEdgesThreshold(smoothness: number): number {
  return fr(4000 + fr(30000 * clamp01(fr(smoothness))));
}

/** The Accented Edges output for a single (grey) pixel `(x, y)`. Exposed for isolated testing.
 *  Precondition: `image` non-empty and `(x,y)` in bounds (`accentedEdges2D` guarantees this). */
export function accentedEdgesPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  width: number,
  brightness: number,
  smoothness: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const v = image[y][x];
  const gain = accentedEdgesGain(width);
  const thresh = accentedEdgesThreshold(smoothness);
  const edgeColor = fr(clamp01(fr(brightness)) * 65535);
  // edge-clamped luma at (x+dx, y+dy)
  const l = (dx: number, dy: number): number => luma(image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)]);
  // Sobel: columns weighted (1,2,1) differenced across x; rows differenced across y
  const gx = fr(fr(fr(l(1, -1) + fr(2 * l(1, 0))) + l(1, 1)) - fr(fr(l(-1, -1) + fr(2 * l(-1, 0))) + l(-1, 1)));
  const gy = fr(fr(fr(l(-1, 1) + fr(2 * l(0, 1))) + l(1, 1)) - fr(fr(l(-1, -1) + fr(2 * l(0, -1))) + l(1, -1)));
  const mag = fr(Math.sqrt(fr(fr(gx * gx) + fr(gy * gy))));
  const edge = clamp01(fr(fr(mag / thresh) * gain)); // ·cov, cov = 1
  const out = fr(v + fr(fr(edgeColor - v) * edge));
  return Math.trunc(out < 0 ? 0 : out > ACCENTED_EDGES_MAX ? ACCENTED_EDGES_MAX : out);
}

/** Apply Accented Edges to a single-channel (grey) 2-D image (u16 values 0..65535). Per pixel uses
 *  a 3×3 Sobel neighbourhood (edge-clamped). Does not mutate the input. */
export function accentedEdges2D(
  image: readonly (readonly number[])[],
  width: number,
  brightness: number,
  smoothness: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = accentedEdgesPixel(image, x, y, width, brightness, smoothness);
    }
  }
  return out;
}
