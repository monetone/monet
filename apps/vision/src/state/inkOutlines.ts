// ─────────────────────────────────────────────────────────────
// Ink Outlines (Filter ▸ Brush Strokes ▸ Ink Outlines) — a two-part pen-and-ink look: it inks the
// EDGES dark (a Sobel luminance gradient darkens the line where the image changes) and washes the
// FLATS toward white (the more uniform a region, the more it is lightened), giving crisp dark
// outlines over a bleached paper. Deterministic; engine-free so it unit-tests in node.
//
// Edge strength is a LUMINANCE gradient (Rec.601 over the RAW 16-bit values); both the ink and the
// wash apply per channel, so on a grey image (R=G=B) this matches `ink_outlines` bit-for-bit —
// modelled here as one channel.
//
// MUST match `filters.rs ink_outlines` (grey domain, full selection ⇒ cov 1):
//   gain = 0.5 + 2·clamp(stroke_length,0,1);  dark = clamp(dark_intensity,0,1);  light = clamp(light_intensity,0,1)
//   luma(v) = v·0.299 + v·0.587 + v·0.114                 (RAW; edge-clamped 3×3 neighbourhood)
//   gx = Sobel-x of luma;  gy = Sobel-y of luma;  edge = clamp(sqrt(gx²+gy²)/30000·gain, 0, 1)
//   inked = v·(1 − edge·dark)                              // strong edges → dark ink
//   out   = inked + (65535 − inked)·(1 − edge)·light       // flats → toward white
//   px    = clamp(v + (out − v)·cov, 0, 65535) as u16      (cov=1 ⇒ out; TRUNCATES)
//
// A FLAT field is NOT the identity (zero gradient ⇒ edge 0 ⇒ out = v + (65535−v)·light) unless
// light = 0. A strong edge saturates edge to 1 ⇒ out = v·(1 − dark) (pure ink, no wash).
//
// Fully bit-exact: the only non-elementary op is `sqrt`, which is IEEE-correctly-rounded, so
// `fround(Math.sqrt(x))` equals the engine's `f32::sqrt(x)` (double-rounding theorem); every other
// op is + − × ÷ or a clamp. `Math.fround` per sub-op reproduces the engine's f32 order.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const INK_OUTLINES_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** RAW luminance of a grey pixel `v` (R=G=B=v): `v·C_R + v·C_G + v·C_B` (NOT divided by 65535). */
const luma = (v: number): number => fr(fr(fr(C_R * v) + fr(C_G * v)) + fr(C_B * v));

/** Edge gain `0.5 + 2·clamp(stroke_length,0,1)` (0.5..2.5). Exposed for testing. */
export function inkOutlinesGain(strokeLength: number): number {
  return fr(0.5 + fr(2 * clamp01(fr(strokeLength))));
}

/** The Ink Outlines output for a single (grey) pixel `(x, y)`. Exposed for isolated testing.
 *  Precondition: `image` non-empty and `(x,y)` in bounds (`inkOutlines2D` guarantees this). */
export function inkOutlinesPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  strokeLength: number,
  darkIntensity: number,
  lightIntensity: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const v = image[y][x];
  const gain = inkOutlinesGain(strokeLength);
  const dark = clamp01(fr(darkIntensity));
  const light = clamp01(fr(lightIntensity));
  const l = (dx: number, dy: number): number => luma(image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)]);
  const gx = fr(fr(fr(l(1, -1) + fr(2 * l(1, 0))) + l(1, 1)) - fr(fr(l(-1, -1) + fr(2 * l(-1, 0))) + l(-1, 1)));
  const gy = fr(fr(fr(l(-1, 1) + fr(2 * l(0, 1))) + l(1, 1)) - fr(fr(l(-1, -1) + fr(2 * l(0, -1))) + l(1, -1)));
  const mag = fr(Math.sqrt(fr(fr(gx * gx) + fr(gy * gy))));
  const edge = clamp01(fr(fr(mag / 30000) * gain));
  const inked = fr(v * fr(1 - fr(edge * dark)));
  const out = fr(inked + fr(fr(fr(INK_OUTLINES_MAX - inked) * fr(1 - edge)) * light));
  const blended = fr(v + fr(out - v)); // cov = 1 (full selection)
  return Math.trunc(blended < 0 ? 0 : blended > INK_OUTLINES_MAX ? INK_OUTLINES_MAX : blended);
}

/** Apply Ink Outlines to a single-channel (grey) 2-D image (u16 values 0..65535). Per pixel uses a
 *  3×3 Sobel neighbourhood (edge-clamped). Does not mutate the input. */
export function inkOutlines2D(
  image: readonly (readonly number[])[],
  strokeLength: number,
  darkIntensity: number,
  lightIntensity: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = inkOutlinesPixel(image, x, y, strokeLength, darkIntensity, lightIntensity);
    }
  }
  return out;
}
