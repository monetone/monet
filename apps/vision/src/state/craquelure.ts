// ─────────────────────────────────────────────────────────────
// Craquelure (Filter ▸ Texture ▸ Craquelure) — paints the image onto a high-relief plaster surface
// veined with a fine network of cracks. The cracks follow the LEVEL-SET of a smooth value-noise
// field: where the noise is near 0.5 a dark groove is cut (depth), with a light ridge just beside
// it (brightness); everywhere else the plaster keeps the image. Deterministic; engine-free so it
// unit-tests in node. Reuses the bit-exact `texNoise` hash lattice from the Texture Grain mirror.
//
// The crack shade adds equally to every channel, so a grey image (R=G=B) matches `craquelure`
// bit-for-bit — modelled here as one channel.
//
// MUST match `filters.rs craquelure` (full selection ⇒ cov 1):
//   depth = clamp(crack_depth,0,1);  depth ≤ 0 → identity
//   bright = clamp(crack_brightness,0,1);  freq = 1 / max(crack_spacing, 2);  half = 0.06
//   d = |tex_noise(x·freq, y·freq) − 0.5|                              (distance to the crack centre)
//   shade = d < half        ? −depth·(1 − d/half)·65535               // groove (darkest at the crack)
//         : d < half·2       ? bright·(1 − (d−half)/half)·65535        // ridge (light lip beside it)
//         : 0                                                          // plaster — keep the image
//   shade == 0 → unchanged;  else  px = clamp(v + shade, 0, 65535) as u16   (cov=1; TRUNCATES)
//
// Fully bit-exact: `tex_noise` is integer-hash + bilinear smoothstep (exact), and every other op is
// + − × ÷ or a clamp/compare (no trig, no sqrt). `freq` is a COMPUTED f32 (1/spacing), not an f64
// literal, so `fr(x·freq)` equals the engine's `x as f32 · freq`. `Math.fround` per sub-op
// reproduces the engine's f32 order; the two crack thresholds are hard decisions on the exact noise.
// ─────────────────────────────────────────────────────────────

import { texNoise } from "./textureGrain";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const CRAQUELURE_MAX = 65535;

const HALF = fr(0.06); // crack half-width in noise units
const HALF2 = fr(HALF * 2);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampU16 = (x: number): number => (x < 0 ? 0 : x > CRAQUELURE_MAX ? CRAQUELURE_MAX : x);

/** Noise frequency `1 / max(crack_spacing, 2)` (wider spacing → lower frequency → broader cracks). */
export function craquelureFreq(crackSpacing: number): number {
  return fr(1 / Math.max(fr(crackSpacing), 2));
}

/** The signed crack shade (an f32 offset) at noise-distance `d` = |noise − 0.5|: negative in the
 *  groove, positive on the ridge, 0 on the plaster. Exposed for testing. */
export function craquelureShade(d: number, depth: number, bright: number): number {
  if (d < HALF) {
    return fr(fr(-depth * fr(1 - fr(d / HALF))) * 65535); // groove
  }
  if (d < HALF2) {
    return fr(fr(bright * fr(1 - fr(fr(d - HALF) / HALF))) * 65535); // ridge
  }
  return 0; // plaster
}

/** The Craquelure output for a single (grey) pixel value `v` at `(x, y)`. Exposed for testing. */
export function craquelurePixel(
  v: number,
  x: number,
  y: number,
  crackSpacing: number,
  crackDepth: number,
  crackBrightness: number,
): number {
  const depth = clamp01(fr(crackDepth));
  if (depth <= 0) return v; // no-op
  const bright = clamp01(fr(crackBrightness));
  const freq = craquelureFreq(crackSpacing);
  const d = Math.abs(fr(texNoise(fr(x * freq), fr(y * freq)) - 0.5));
  const shade = craquelureShade(d, depth, bright);
  if (shade === 0) return v; // plaster — keep the image
  return Math.trunc(clampU16(fr(v + shade))); // cov = 1
}

/** Apply Craquelure to a single-channel (grey) 2-D image (u16 values 0..65535). `crack_spacing`
 *  (≥2 effective) sets the crack scale; `crack_depth`/`crack_brightness` ∈ [0,1]. Does not mutate. */
export function craquelure2D(
  image: readonly (readonly number[])[],
  crackSpacing: number,
  crackDepth: number,
  crackBrightness: number,
): number[][] {
  return image.map((row, y) =>
    row.map((v, x) => craquelurePixel(v, x, y, crackSpacing, crackDepth, crackBrightness)),
  );
}
