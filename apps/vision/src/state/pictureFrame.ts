// ─────────────────────────────────────────────────────────────
// Picture Frame (Filter ▸ Render ▸ Picture Frame) — paints a raised, beveled border of a chosen
// colour around the image, leaving the interior untouched. Unlike the pixel-transform filters,
// this is PROCEDURAL: a frame pixel's value depends on its POSITION (distance to the nearest edge
// and which side it is on), not on the underlying pixel. Deterministic; engine-free so it unit-
// tests in node.
//
// The bevel is shaded to look raised: lighter near the top/left edges, darker near the
// bottom/right, with a flat band in the middle and a slightly darker inner lip. The shade scales
// the frame colour per channel, so a grey frame colour (R=G=B) matches `picture_frame` bit-for-bit
// — modelled here as one channel.
//
// MUST match `filters.rs picture_frame` (full selection ⇒ cov 1):
//   width = max(width,1);  bevel = max(width/4, 1)   (integer division)
//   d = min(x, y, W-1-x, H-1-y)                       (distance to the nearest edge)
//   d ≥ width → interior, untouched
//   shade = d < bevel
//             ? ((x≤y ∧ x≤W-1-x) ∨ (y≤x ∧ y≤H-1-y)) ? 1 + (bevel-d)·0.12   // top/left → lighter
//                                                     : 1 − (bevel-d)·0.12   // bottom/right → darker
//           : d ≥ width-bevel ? 1 − (d-(width-bevel))·0.08                   // inner lip → darker
//           : 1                                                              // flat band
//   out = round(clamp(base·shade, 0, 1)·65535),  base = frameColor/255       (alpha set opaque)
//
// Fully bit-exact: every op is + − × or a clamp/round — innocuous under f64→f32 double rounding
// (no trig, no sqrt). The branch selection is integer-only (exact); `Math.fround` per sub-op
// reproduces the engine's f32 order for the shade and the colour scaling.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const PICTURE_FRAME_MAX = 65535;

const C12 = fr(0.12); // bevel light/dark slope
const C08 = fr(0.08); // inner-lip slope

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** f32 `round()` — nearest integer, halves away from zero. All shades are > 0 here. */
const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

/** Distance from `(x, y)` to the nearest image edge: `min(x, y, W-1-x, H-1-y)`. */
export function pictureFrameDist(x: number, y: number, w: number, h: number): number {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

/** Effective frame width and bevel size for a requested `width` (matches the engine's clamping). */
export function pictureFrameBevel(width: number): { width: number; bevel: number } {
  const wd = Math.max(Math.trunc(width), 1);
  return { width: wd, bevel: Math.max(Math.trunc(wd / 4), 1) };
}

/** The raised-bevel shade (an f32 multiplier ~0.76..1.24) for a FRAME pixel `(x, y)`. Precondition:
 *  the pixel is in the frame band (d < width). Exposed for testing the bevel branches. */
export function pictureFrameShade(x: number, y: number, w: number, h: number, width: number): number {
  const { width: wd, bevel } = pictureFrameBevel(width);
  const d = pictureFrameDist(x, y, w, h);
  if (d < bevel) {
    const topLeft = (x <= y && x <= w - 1 - x) || (y <= x && y <= h - 1 - y);
    const step = fr((bevel - d) * C12);
    return topLeft ? fr(1 + step) : fr(1 - step);
  }
  if (d >= wd - bevel) {
    return fr(1 - fr((d - (wd - bevel)) * C08));
  }
  return 1;
}

/** The Picture Frame output for a single (grey) pixel `(x, y)` over an `input` value, with grey
 *  frame colour `frameColor` (u8, 0..255). Frame pixels become `frameColor·shade`; interior pixels
 *  keep `input`. Exposed for isolated testing. */
export function pictureFramePixel(
  input: number,
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  frameColor: number,
): number {
  const { width: wd } = pictureFrameBevel(width);
  if (pictureFrameDist(x, y, w, h) >= wd) return input; // interior untouched
  const base = fr(frameColor / 255);
  const shade = pictureFrameShade(x, y, w, h, width);
  const val = fr(clamp01(fr(base * shade)) * 65535);
  return roundHalfAway(val);
}

/** Apply Picture Frame to a single-channel (grey) 2-D image (u16 values 0..65535) with a grey
 *  frame colour `frameColor` (u8). The interior is left untouched. Does not mutate the input. */
export function pictureFrame2D(
  image: readonly (readonly number[])[],
  width: number,
  frameColor: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = pictureFramePixel(image[y][x], x, y, w, h, width, frameColor);
    }
  }
  return out;
}
