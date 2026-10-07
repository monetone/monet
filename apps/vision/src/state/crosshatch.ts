// ─────────────────────────────────────────────────────────────
// Crosshatch (Filter ▸ Brush Strokes ▸ Crosshatch) — overlays the image with crossed diagonal
// pencil strokes, darkening it most where it is already dark and where the two hatch grids
// fall. Unlike the two-tone Sketch filters, this MULTIPLICATIVELY darkens the existing pixels
// (preserving their colour) — `out = src · (1 − darken)`. Deterministic; engine-free so it
// unit-tests in node.
//
// The darkening is modulated by LUMINANCE (Rec.601 over R,G,B); the multiply is per channel
// with that shared factor, so on a grey image (R=G=B=v, luminance = the channel's own
// self-weighting) this matches `crosshatch` bit-for-bit — modelled here as one channel.
//
// MUST match `filters.rs crosshatch` (grey domain):
//   str = clamp(strength,0,1);  str ≤ 0 → no-op
//   spacing = 3 + 9·clamp(length,0,1);  half = clamp(0.5 − 0.42·clamp(sharpness,0,1), 0.08, 0.5)
//   line(v): f = rem_euclid(v, spacing)/spacing;  d = min(f, 1−f);  d<half ? 1−d/half : 0
//   per pixel: darkness = 1 − luma;  hatch = max(line(x+y), line(x−y))
//             darken = str · darkness · hatch;  out = clamp(src·(1−darken), 0, 65535) as u16
//
// The two hatch phases x+y and x−y cross to form the weave; x−y goes NEGATIVE for x<y, so the
// `rem_euclid` negative lift is load-bearing there. Fully bit-exact: every op is + − × ÷ rem
// min/max or a clamp/compare — all innocuous under f64→f32 double rounding (no trig, no sqrt).
// Mirrors the `graphicPen.ts` / Rec.601 house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const CROSSHATCH_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);
const SHARP_K = Math.fround(0.42);
const MIN_HALF = Math.fround(0.08);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(C_R * v) + fr(C_G * v)) + fr(C_B * v)) / 65535);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Hatch-line spacing `3 + 9·clamp(length,0,1)` (3..12 px). Exposed for testing. */
export function crosshatchSpacing(length: number): number {
  return fr(3 + fr(9 * clamp01(fr(length))));
}

/** Line half-width as a period fraction: `clamp(0.5 − 0.42·sharpness, 0.08, 0.5)`. Exposed. */
export function crosshatchHalf(sharpness: number): number {
  const v = fr(0.5 - fr(SHARP_K * clamp01(fr(sharpness))));
  return v < MIN_HALF ? MIN_HALF : v > 0.5 ? 0.5 : v;
}

/** Triangular hatch factor for phase `v`: 1 on a line centre (every `spacing`), fading to 0 at
 *  `half` of the period away. `v` may be negative (the x−y phase) — `rem_euclid` lifts it. */
function line(v: number, spacing: number, half: number): number {
  let r = fr(v % spacing);
  if (r < 0) r = fr(r + spacing);
  const f = fr(r / spacing);
  const d = Math.min(f, fr(1 - f));
  return d < half ? fr(1 - fr(d / half)) : 0;
}

/** The Crosshatch output for a single (grey/luminance) pixel `(x, y)`: the value darkened by
 *  the local cross-hatch. Exposed for isolated testing. Precondition: `image` non-empty,
 *  `(x,y)` in bounds (`crosshatch2D` guarantees this). */
export function crosshatchPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  length: number,
  sharpness: number,
  strength: number,
): number {
  const v = image[y][x];
  const str = clamp01(fr(strength));
  if (str <= 0) return v; // no-op
  const spacing = crosshatchSpacing(length);
  const half = crosshatchHalf(sharpness);
  const darkness = fr(1 - lum(v));
  const hatch = Math.max(line(x + y, spacing, half), line(x - y, spacing, half));
  const darken = fr(fr(str * darkness) * hatch);
  const val = fr(v * fr(1 - darken));
  return Math.trunc(val < 0 ? 0 : val > CROSSHATCH_MAX ? CROSSHATCH_MAX : val);
}

/** Apply Crosshatch to a single-channel (luminance) 2-D image (u16 values 0..65535). */
export function crosshatch2D(
  image: readonly (readonly number[])[],
  length: number,
  sharpness: number,
  strength: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  if (clamp01(fr(strength)) <= 0) return out; // no-op (engine returns early)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = crosshatchPixel(image, x, y, length, sharpness, strength);
    }
  }
  return out;
}
