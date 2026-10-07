// ─────────────────────────────────────────────────────────────
// Plastic Wrap (Filter ▸ Artistic ▸ Plastic Wrap) — coats the image in shiny plastic: a white
// specular highlight forms along the surface CURVATURE (the luminance gradient), as if shrink-
// wrapped. Unlike the edge/relief family (find_edges/emboss/accented_edges/ink_outlines) it keeps
// the full image and only ADDS a sheen at ridges, leaving flats untouched. Deterministic; engine-
// free so it unit-tests in node.
//
// Curvature is measured on the LUMINANCE (Rec.601, raw 16-bit), optionally box-blurred; the sheen
// adds toward white per channel, so on a grey image (R=G=B) this matches `plastic_wrap` bit-for-bit
// — modelled here as one channel.
//
// MUST match `filters.rs plastic_wrap` (full selection ⇒ cov 1):
//   hs = clamp(highlight_strength,0,1);  hs ≤ 0 → identity
//   r = round(clamp(smoothness,0,1)·6) (0..6);  d = 1 + round(clamp(detail,0,1)·3) (1..4)
//   luma(v) = v·0.299 + v·0.587 + v·0.114        (raw); field = box-blur(luma, r) (f32 mean) or luma
//   gain = 0.5 + hs·3
//   gx = field(x+d,y) − field(x−d,y);  gy = field(x,y+d) − field(x,y−d)   (edge-clamped)
//   mag = sqrt(gx² + gy²);  hl = sqrt(clamp(mag/65535·gain, 0, 1))
//   out = v + (65535 − v)·hl;  px = clamp(v + (out − v)·cov, 0, 65535) as u16   (cov=1 ⇒ out; TRUNCATES)
//
// Fully bit-exact: the only non-elementary op is `sqrt`, which is IEEE-correctly-rounded, so
// `fround(Math.sqrt(x))` equals the engine's `f32::sqrt(x)` (double-rounding theorem). The box-blur
// sum is f32 (matching the engine's f32 accumulator; ≤169 terms < 2²⁴). `Math.fround` per sub-op
// reproduces the engine's f32 order. A flat field has zero gradient ⇒ hl 0 ⇒ identity.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const PLASTIC_WRAP_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampU16 = (x: number): number => (x < 0 ? 0 : x > PLASTIC_WRAP_MAX ? PLASTIC_WRAP_MAX : x);
/** f32 `round()` — nearest integer, halves away from zero (matches Rust `f32::round`). */
const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

/** Raw luminance of a grey pixel `v` (R=G=B=v): `v·C_R + v·C_G + v·C_B`, in the engine's f32 order. */
const luma = (v: number): number => fr(fr(fr(C_R * v) + fr(C_G * v)) + fr(C_B * v));

/** The smoothing radius (0..6) and gradient distance (1..4) derived from the params. Exposed. */
export function plasticWrapParams(detail: number, smoothness: number): { r: number; d: number } {
  return {
    r: roundHalfAway(fr(clamp01(fr(smoothness)) * 6)),
    d: 1 + roundHalfAway(fr(clamp01(fr(detail)) * 3)),
  };
}

/** Apply Plastic Wrap to a single-channel (grey) 2-D image (u16 values 0..65535). Does not mutate
 *  the input. `highlight_strength`/`detail`/`smoothness` ∈ [0,1]. */
export function plasticWrap2D(
  image: readonly (readonly number[])[],
  highlightStrength: number,
  detail: number,
  smoothness: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  const hs = clamp01(fr(highlightStrength));
  if (hs <= 0) return out; // no-op (engine early return)
  const { r, d } = plasticWrapParams(detail, smoothness);
  const gain = fr(0.5 + fr(hs * 3));

  // Pass 1: luminance field, optionally box-blurred by r (f32 mean over a (2r+1)² edge-clamped window).
  const lf = (x: number, y: number): number => luma(image[clampIdx(y, h - 1)][clampIdx(x, w - 1)]);
  let field: number[][];
  if (r === 0) {
    field = image.map((row) => row.map((v) => luma(v)));
  } else {
    field = [];
    for (let y = 0; y < h; y++) {
      const frow: number[] = [];
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            s = fr(s + lf(x + dx, y + dy)); // f32 accumulation, like the engine
            c += 1;
          }
        }
        frow.push(fr(s / c));
      }
      field.push(frow);
    }
  }
  const fAt = (x: number, y: number): number => field[clampIdx(y, h - 1)][clampIdx(x, w - 1)];

  // Pass 2: gradient-magnitude sheen toward white.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = fr(fAt(x + d, y) - fAt(x - d, y));
      const gy = fr(fAt(x, y + d) - fAt(x, y - d));
      const mag = fr(Math.sqrt(fr(fr(gx * gx) + fr(gy * gy))));
      const hl = fr(Math.sqrt(clamp01(fr(fr(mag / 65535) * gain))));
      const v = image[y][x];
      const o = fr(v + fr(fr(PLASTIC_WRAP_MAX - v) * hl));
      const blended = fr(v + fr(o - v)); // cov = 1
      out[y][x] = Math.trunc(clampU16(blended));
    }
  }
  return out;
}
