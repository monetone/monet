// ─────────────────────────────────────────────────────────────
// Film Grain (Filter ▸ Artistic ▸ Film Grain) — even, monochromatic photographic grain
// with a highlight-protection control. Unlike Add Noise (uniform random ±deltas), the
// grain fades out in the highlights so bright areas stay clean, mimicking real film.
// Engine-free so it unit-tests in node; it draws from the SAME seeded xorshift32 as
// Add Noise (reused from `addNoise.ts`), so it is reproducible and deterministic.
//
// MUST match `filters.rs film_grain`:
//   amt    = grain · (0.08 + 0.12 · clamp01(intensity)) · 65535
//   thresh = (1 − clamp01(highlight)) · 65535
//   per pixel (full coverage): luma = 0.299r + 0.587g + 0.114b  (Rec.601 on RAW u16),
//     protect = luma ≤ thresh ? 1 : clamp01((65535 − luma) / max(65535 − thresh, 1)),
//     d = next() · amt · protect · coverage        (ONE monochromatic delta per pixel),
//     each channel: (v + d).clamp(0, 65535) as u16 (truncate). Alpha untouched.
//   `highlight` raises how much of the bright range is protected: highlight 0 → thresh
//   65535 → no protection (grain everywhere); highlight 1 → thresh 0 → grain ramps from
//   full at black to zero at white.
//
// All arithmetic is reproduced in f32 (`Math.fround`) — the luma feeds a branch and the
// delta feeds a truncation, both boundary-sensitive — so this matches the engine's u16
// output bit-for-bit on full-coverage data. The dialog maps Grain/20, Highlight/20,
// Intensity/10 → the 0..1 fractions here. Mirrors the `addNoise.ts` house style.
// ─────────────────────────────────────────────────────────────

import { makeXorshift32, noiseValue, applyNoiseChannel, NOISE_MAX } from "./addNoise";

const fr = Math.fround;
const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Rec.601 coefficients as f32 literals (the engine weights raw u16 values directly).
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);
const C_008 = Math.fround(0.08);
const C_012 = Math.fround(0.12);

/** Rec.601 luma of RAW 16-bit channels (0..65535) — the engine weights u16 directly,
 *  evaluated in f32 (`((Cr·r + Cg·g) + Cb·b)`) so the protection branch matches. */
export function lumaU16(r: number, g: number, b: number): number {
  return fr(fr(fr(C_R * r) + fr(C_G * g)) + fr(C_B * b));
}

/** Grain amplitude in 16-bit units: `grain · (0.08 + 0.12·clamp01(intensity)) · 65535`.
 *  Each input is pre-rounded to f32 — the engine receives all three as f32 parameters. */
export function grainAmplitude(grain: number, intensity: number): number {
  const k = fr(C_008 + fr(C_012 * clamp01(fr(intensity))));
  return fr(fr(fr(grain) * k) * NOISE_MAX);
}

/** The highlight-protection threshold in 16-bit units: `(1 − clamp01(highlight)) · 65535`.
 *  Luma at/below this gets full grain; above it the grain fades to 0 at white. */
export function grainThreshold(highlight: number): number {
  return fr(fr(1 - clamp01(fr(highlight))) * NOISE_MAX);
}

/** The grain-protection factor (0..1) for a pixel's luma: 1 at/below `thresh`, ramping
 *  linearly to 0 at white. `protect = luma ≤ thresh ? 1 : (65535−luma)/max(65535−thresh,1)`. */
export function highlightProtect(luma: number, thresh: number): number {
  if (luma <= thresh) return 1;
  const denRaw = fr(NOISE_MAX - thresh);
  const den = denRaw < 1 ? 1 : denRaw; // engine's `.max(1.0)`
  return clamp01(fr(fr(NOISE_MAX - luma) / den));
}

/** The monochromatic grain delta in 16-bit units: `noise · amt · protect · coverage`. */
export function grainDelta(noise: number, amt: number, protect: number, coverage = 1): number {
  return fr(fr(fr(noise * amt) * protect) * coverage);
}

export interface GrainRgb {
  r: number;
  g: number;
  b: number;
}

/** Grain one 16-bit RGB pixel: draw ONE delta (from `rng`), scale it by the pixel's
 *  highlight protection, and add it to all three channels (monochromatic), clamping +
 *  truncating like the engine. Mirrors the engine's per-pixel order. */
export function applyFilmGrainPixel(
  rng: () => number,
  r: number,
  g: number,
  b: number,
  amt: number,
  thresh: number,
  coverage = 1,
): GrainRgb {
  const protect = highlightProtect(lumaU16(r, g, b), thresh);
  const d = grainDelta(noiseValue(rng()), amt, protect, coverage);
  return {
    r: applyNoiseChannel(r, d),
    g: applyNoiseChannel(g, d),
    b: applyNoiseChannel(b, d),
  };
}

/** Apply Film Grain to a flat 16-bit RGBA buffer (length = n·4), returning a fresh
 *  buffer. Mirrors `filters.rs film_grain` at full coverage (whole layer): xorshift32
 *  seeded `seed | 1`, one monochromatic delta per pixel scaled by highlight protection,
 *  alpha copied untouched. `grain`/`highlight`/`intensity` are 0..1 fractions. */
export function filmGrain(
  pixels: ArrayLike<number>,
  grain: number,
  highlight: number,
  intensity: number,
  seed: number,
): number[] {
  const out = Array.from(pixels, (v) => v);
  const amt = grainAmplitude(grain, intensity);
  const thresh = grainThreshold(highlight);
  const rng = makeXorshift32(seed);
  const n = Math.floor(out.length / 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const px = applyFilmGrainPixel(rng, out[p], out[p + 1], out[p + 2], amt, thresh, 1);
    out[p] = px.r;
    out[p + 1] = px.g;
    out[p + 2] = px.b;
    // out[p + 3] (alpha) left untouched
  }
  return out;
}
