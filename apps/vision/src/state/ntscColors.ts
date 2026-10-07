// ─────────────────────────────────────────────────────────────
// NTSC Colors (Filter ▸ Video ▸ NTSC Colors) — restricts colours to the range that broadcast
// (NTSC) video can reproduce. Unlike the spatial filters, this is a pure PER-PIXEL colour
// transform (no neighbourhood): it desaturates each pixel 15% toward its own luminance, then
// compresses every channel into the NTSC-safe range [16/255, 235/255]. Deterministic; engine-
// free so it unit-tests in node.
//
// The three channels are COUPLED through luminance (the desaturation pulls each toward `lum`), so
// — unlike most mirrors — a grey image hides the interesting part: for R=G=B the desaturation
// term `(c−lum)` is ~0, leaving only the range compression. So this is modelled as a genuine
// RGB-pixel transform, not a single grey channel, and tested with COLOUR fixtures.
//
// MUST match `filters.rs ntsc_colors` (full selection ⇒ cov 1; alpha preserved):
//   lo = 16/255,  hi = 235/255
//   lum = 0.299·r + 0.587·g + 0.114·b              (r,g,b are the channel fractions in [0,1])
//   ch(c) = clamp(lum + (c − lum)·0.85, 0, 1)·(hi − lo) + lo
//   out_c = round(ch(c)·65535)                     (f32 round-half-away; values are ≥ lo·65535 > 0)
//
// Fully bit-exact: every op is + − × or a clamp/round — all innocuous under f64→f32 double
// rounding (no trig, no sqrt). `Math.fround` per sub-op reproduces the engine's f32 order.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const NTSC_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);
/** NTSC-safe range endpoints and the desaturation factor, as the engine's f32 literals. */
const LO = fr(16 / 255);
const HI = fr(235 / 255);
const RANGE = fr(HI - LO); // 219/255
const DESAT = fr(0.85); // pull 15% toward luminance

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** f32 `round()` — nearest integer, halves away from zero. All inputs here are ≥ LO·65535 > 0. */
const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

/** Rec.601 luminance of an RGB pixel given as channel fractions in [0,1], in the engine's f32
 *  order `((C_R·r + C_G·g) + C_B·b)`. Exposed for testing. */
export function ntscLum(rf: number, gf: number, bf: number): number {
  return fr(fr(fr(C_R * rf) + fr(C_G * gf)) + fr(C_B * bf));
}

/** The NTSC map for one channel fraction `cf` given the pixel luminance `lum`: desaturate toward
 *  `lum`, clamp, then compress into [LO, HI]. Returns a fraction in [LO, HI]. Exposed for testing. */
export function ntscChannel(cf: number, lum: number): number {
  const desat = fr(lum + fr(fr(cf - lum) * DESAT));
  return fr(fr(clamp01(desat) * RANGE) + LO);
}

/** The NTSC Colors output for a single u16 RGB pixel `[r, g, b]` (0..65535 each). Returns the
 *  three transformed u16 channels; alpha is the caller's concern (the engine preserves it). */
export function ntscPixel(r: number, g: number, b: number): [number, number, number] {
  const rf = fr(r / 65535);
  const gf = fr(g / 65535);
  const bf = fr(b / 65535);
  const lum = ntscLum(rf, gf, bf);
  return [
    roundHalfAway(fr(ntscChannel(rf, lum) * 65535)),
    roundHalfAway(fr(ntscChannel(gf, lum) * 65535)),
    roundHalfAway(fr(ntscChannel(bf, lum) * 65535)),
  ];
}

/** An RGB pixel as three u16 channels. */
export type RGB = readonly [number, number, number];

/** Apply NTSC Colors to a 2-D image of RGB pixels (u16 channels). Per pixel, no neighbourhood.
 *  Does not mutate the input. */
export function ntscColors2D(image: readonly (readonly RGB[])[]): [number, number, number][][] {
  return image.map((row) => row.map(([r, g, b]) => ntscPixel(r, g, b)));
}
