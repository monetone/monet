// ─────────────────────────────────────────────────────────────
// Wave (Filter ▸ Distort ▸ Wave) — displace each pixel by a sum of sine/triangle/square
// waves, like ripples on disturbed water. Unlike Photoshop's UI (which seeds its generators
// from a Randomize button), the engine's generators are DETERMINISTIC: their wavelength and
// amplitude are evenly interpolated across [min, max] and their phase is a golden-ratio
// scatter, so the same parameters always give the same result. Engine-free so it unit-tests
// in node, reusing Twirl's `sampleBilinear`.
//
// MUST match `mod.rs wave_buf`:
//   ng = max(num_gen, 1).  For g in 0..ng (t = g/(ng−1), or 0 when ng==1):
//     wl = max(wl_min + (wl_max−wl_min)·t, 1),  amp = amp_min + (amp_max−amp_min)·t,
//     phase = fract(g·0.618034)·τ
//   wavef(t): sine = sin t;  triangle = (2/π)·asin(clamp(sin t, −1, 1));  square = sign(sin t)
//   per pixel:  dx = Σ amp·wavef(τ·y/wl + phase),  dy = Σ amp·wavef(τ·x/wl + phase)
//     (CROSS-AXIS: the horizontal shift dx is driven by the ROW y, the vertical shift dy by
//      the COLUMN x — a straight vertical line bends as you go down it)
//   sx = x − dx·scale_h,  sy = y − dy·scale_v
//   wrap ? sx = rem_euclid(sx, w) : sx = clamp(sx, 0, w−1)   (same for sy / h)
//   out = sample_bi(sx, sy)
//
// There is NO half-pixel centre bias (the engine samples at integer x,y minus the
// displacement), so any identity case (zero amplitude, or zero scale on an axis) samples
// exactly the source pixel — these are EXACT, not approximate. In `wrap` mode only the base
// coordinate wraps; `sample_bi` still edge-clamps the +1 bilinear tap (so the seam replicates
// the border rather than wrapping the interpolation) — mirrored faithfully here.
//
// f32 throughout (`Math.fround`); the bilinear taps are the only rounding, so sine/clamp
// paths are bit-exact to the engine and the f32 trig (sin/asin via f64-then-fround) stays
// within ≤1 LSB. Mirrors the `twirl.ts` / `radialBlur.ts` house style.
// ─────────────────────────────────────────────────────────────

import { sampleBilinear } from "./twirl";

const fr = Math.fround;
/** `std::f32::consts::TAU` — the f32 nearest to 2π. */
const TAU = Math.fround(2 * Math.PI);
/** `2.0 / std::f32::consts::PI` as an f32 — the triangle-wave normaliser. */
const TWO_OVER_PI = Math.fround(2 / Math.fround(Math.PI));
/** The engine's golden-ratio phase scatter constant (`0.618_034` f32). */
const GOLDEN = Math.fround(0.618034);
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const WAVE_MAX = 65535;

/** Clamp to `[0, hi]` — the engine's edge-replicate border (non-wrap mode). */
const clampTo = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Least non-negative remainder, mirroring Rust's `f32::rem_euclid` (wrap mode). */
const remEuclid = (a: number, m: number): number => {
  const r = fr(a % m);
  return r < 0 ? fr(r + m) : r;
};

/** One deterministic wave generator: wavelength (≥1 px), amplitude, and phase offset. */
export interface WaveGen {
  wl: number;
  amp: number;
  phase: number;
}

/** Derive the `max(numGen,1)` generators: wavelength/amplitude evenly interpolated across
 *  [min,max], phase a golden-ratio scatter. Exposed so the derivation is unit-testable. */
export function waveGenerators(
  numGen: number,
  wlMin: number,
  wlMax: number,
  ampMin: number,
  ampMax: number,
): WaveGen[] {
  const ng = Math.max(Math.trunc(numGen), 1);
  const wlMinF = fr(wlMin);
  const ampMinF = fr(ampMin);
  const dWl = fr(fr(wlMax) - wlMinF);
  const dAmp = fr(fr(ampMax) - ampMinF);
  const gens: WaveGen[] = [];
  for (let g = 0; g < ng; g++) {
    const t = ng === 1 ? 0 : fr(fr(g) / fr(ng - 1));
    const wl = Math.max(fr(wlMinF + fr(dWl * t)), 1);
    const amp = fr(ampMinF + fr(dAmp * t));
    const gprod = fr(fr(g) * GOLDEN);
    const frac = fr(gprod - Math.trunc(gprod));
    const phase = fr(frac * TAU);
    gens.push({ wl, amp, phase });
  }
  return gens;
}

/** The wave profile at phase `t`: 0 = sine, 1 = triangle, 2 = square (any other = sine). */
function wavef(t: number, waveType: number): number {
  const s = fr(Math.sin(t));
  if (waveType === 1) {
    const c = s < -1 ? -1 : s > 1 ? 1 : s;
    return fr(TWO_OVER_PI * fr(Math.asin(c)));
  }
  if (waveType === 2) return s >= 0 ? 1 : -1;
  return s;
}

/** The raw displacement `(dx, dy)` summed over the generators for destination pixel `(x, y)`.
 *  CROSS-AXIS: `dx` (horizontal) is a function of the row `y`; `dy` (vertical) of the column
 *  `x`. Exposed so the wave geometry is testable independently of the bilinear resample. */
export function waveDisplacement(
  x: number,
  y: number,
  gens: readonly WaveGen[],
  waveType: number,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  const yf = fr(y);
  const xf = fr(x);
  for (const { wl, amp, phase } of gens) {
    const ax = fr(fr(fr(TAU * yf) / wl) + phase);
    dx = fr(dx + fr(amp * wavef(ax, waveType)));
    const ay = fr(fr(fr(TAU * xf) / wl) + phase);
    dy = fr(dy + fr(amp * wavef(ay, waveType)));
  }
  return { dx, dy };
}

/** Apply Wave to a single-channel 2-D image (u16 values 0..65535): inverse-map each pixel
 *  through the generators and reconstruct it with `sampleBilinear`. Run per channel to warp
 *  an opaque RGB image, exactly as the engine does. */
export function wave2D(
  image: readonly (readonly number[])[],
  numGen: number,
  wlMin: number,
  wlMax: number,
  ampMin: number,
  ampMax: number,
  scaleH: number,
  scaleV: number,
  waveType: number,
  wrap: boolean,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  const gens = waveGenerators(numGen, wlMin, wlMax, ampMin, ampMax);
  const scaleHF = fr(scaleH);
  const scaleVF = fr(scaleV);
  const wf = w;
  const hf = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { dx, dy } = waveDisplacement(x, y, gens, waveType);
      let sx = fr(fr(x) - fr(dx * scaleHF));
      let sy = fr(fr(y) - fr(dy * scaleVF));
      if (wrap) {
        sx = remEuclid(sx, wf);
        sy = remEuclid(sy, hf);
      } else {
        sx = clampTo(sx, w - 1);
        sy = clampTo(sy, h - 1);
      }
      out[y][x] = sampleBilinear(image, sx, sy);
    }
  }
  return out;
}
