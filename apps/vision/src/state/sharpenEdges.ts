// ─────────────────────────────────────────────────────────────
// Sharpen Edges (Filter ▸ Sharpen ▸ Sharpen Edges) — a one-click sharpen that fires ONLY
// where the image has strong local contrast (gated by the luminance gradient), so flat areas
// and low-contrast noise stay untouched — unlike plain Sharpen which sharpens everything.
// Deterministic; engine-free so it unit-tests in node.
//
// The edge gate is driven by LUMINANCE (Rec.601 over R,G,B), which couples the channels, so —
// like Smart Blur — this reference models a single LUMINANCE channel: each value v is a grey
// pixel R=G=B=v, for which luminance reduces to its own self-weighting `v·0.299+v·0.587+v·0.114`
// (RAW 16-bit, NOT normalised). On a grey image this matches `sharpen_edges` bit-for-bit; the
// per-channel laplacian is then applied to that channel.
//
// MUST match `filters.rs sharpen_edges` (grey domain):
//   gx = lum(x+1,y) − lum(x−1,y),  gy = lum(x,y+1) − lum(x,y−1)   (`idx` edge-clamps)
//   edge = min(sqrt(gx² + gy²) / 15000, 1)            (15000 ≈ full effect at ~58/255 contrast)
//   if edge ≤ 0 (flat) → leave the pixel unchanged
//   else  lap = 4·c − L − R − U − D    (4-neighbour laplacian of THIS channel, edge-clamped)
//         out = clamp(c + edge·lap, 0, 65535) as u16          (TRUNCATES — `as u16`)
//
// A flat region has zero gradient ⇒ edge 0 ⇒ untouched. The luminance is RAW (no /65535), so
// `lum²` exceeds 2²⁴ and the f32 sum loses precision exactly as the engine does. The output is
// continuous (`base + edge·lap`), so the only f64→f32 double-rounding sites — the `sqrt` and the
// `mag/15000` divide — shift it by ≤1 LSB at most (never the exact-zero gate). Mirrors the
// `glowingEdges.ts` / `smartBlur.ts` house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const SHARPEN_EDGES_MAX = 65535;
/** The full-effect edge magnitude (engine `threshold = 15000.0`). */
const THRESHOLD = 15000;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);

/** RAW Rec.601 luminance of a grey pixel `v` (R=G=B=v) — NO /65535 (engine `lum`). */
const lumRaw = (v: number): number => fr(fr(fr(C_R * v) + fr(C_G * v)) + fr(C_B * v));

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The Sharpen-Edges output for a single (grey/luminance) pixel `(x, y)`: the laplacian sharpen
 *  scaled by the local edge strength, or the pixel unchanged where it is flat. Exposed so the
 *  gate/laplacian is testable independently. Precondition: `image` non-empty, `(x,y)` in bounds. */
export function sharpenEdgesPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const c = image[y][x];
  const xm = clampIdx(x - 1, w - 1);
  const xp = clampIdx(x + 1, w - 1);
  const ym = clampIdx(y - 1, h - 1);
  const yp = clampIdx(y + 1, h - 1);
  const gx = fr(lumRaw(image[y][xp]) - lumRaw(image[y][xm]));
  const gy = fr(lumRaw(image[yp][x]) - lumRaw(image[ym][x]));
  const mag = fr(Math.sqrt(fr(fr(gx * gx) + fr(gy * gy))));
  const edge = Math.min(fr(mag / THRESHOLD), 1);
  if (edge <= 0) return c; // flat → unchanged
  // 4-neighbour laplacian of this channel: 4·c − L − R − U − D (left, right, up, down)
  const lap = fr(fr(fr(fr(fr(4 * c) - image[y][xm]) - image[y][xp]) - image[ym][x]) - image[yp][x]);
  const val = fr(c + fr(edge * lap));
  return Math.trunc(val < 0 ? 0 : val > SHARPEN_EDGES_MAX ? SHARPEN_EDGES_MAX : val);
}

/** Apply Sharpen Edges to a single-channel (luminance) 2-D image (u16 values 0..65535). */
export function sharpenEdges2D(image: readonly (readonly number[])[]): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = sharpenEdgesPixel(image, x, y);
    }
  }
  return out;
}
