// ─────────────────────────────────────────────────────────────
// Add Noise (Filter ▸ Noise ▸ Add Noise) — scatter random ±deltas across the image.
// The randomness is a *seeded* xorshift32 PRNG, so the noise field is fully
// reproducible: the smart-filter path stores the seed in its params and replays the
// identical field on every re-render. Engine-free so it unit-tests in node — and the
// determinism is precisely what makes a "random" filter testable.
//
// MUST match `filters.rs add_noise`:
//   state = seed | 1                                  (xorshift32 needs a non-zero seed)
//   next():  state ^= state << 13; state ^= state >> 17; state ^= state << 5;
//            return (state as f32 / u32::MAX as f32) * 2 − 1   (an f32 in [−1, 1] —
//            closed at 1 because `u32::MAX as f32` rounds up to 2³², so max state → 1.0)
//   amt = amount · 65535
//   per pixel, with coverage `cov`: monochromatic draws ONE delta `d = next()·amt·cov`
//   shared by R,G,B (so neutrals stay neutral); otherwise three independent draws.
//   each channel: `(v + d).clamp(0, 65535) as u16`  — note `as u16` TRUNCATES toward
//   zero (not round-half-up). Alpha is left untouched.
//
// The PRNG and the f32 noise math are reproduced exactly (`Math.fround`), so this
// mirrors the engine's u16 output bit-for-bit on full-coverage (whole-layer) data — the
// `as u16` truncation makes the boundary sensitive, so f32 fidelity matters here.
// The dialog's Amount 0..100% maps to `amount = pct/100`. Mirrors the house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** `u32::MAX as f32` — 4294967295 rounds up to 2³² in f32. */
const U32_MAX_F = Math.fround(4294967295);
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const NOISE_MAX = 65535;

/** One xorshift32 step: uint32 state → next uint32 state (shifts 13/17/5). */
export function xorshift32Step(state: number): number {
  let s = state >>> 0;
  s ^= s << 13;
  s ^= s >>> 17; // u32 logical right shift (engine's `state >> 17` on an unsigned)
  s ^= s << 5;
  return s >>> 0;
}

/** A xorshift32 generator seeded like the engine (`seed | 1`, forced non-zero). Each
 *  call advances and returns the next uint32 state. */
export function makeXorshift32(seed: number): () => number {
  let state = (seed | 1) >>> 0;
  return () => (state = xorshift32Step(state));
}

/** Convert a uint32 PRNG state to the engine's noise value in [−1, 1] (closed at 1
 *  since `u32::MAX as f32` rounds up to 2³²): `(state as f32 / u32::MAX as f32) · 2 − 1`,
 *  evaluated entirely in f32. */
export function noiseValue(state: number): number {
  return fr(fr(fr(fr(state >>> 0) / U32_MAX_F) * 2) - 1);
}

/** A noise generator: each call advances the xorshift and returns a [−1, 1) f32. */
export function makeNoiseRng(seed: number): () => number {
  const rng = makeXorshift32(seed);
  return () => noiseValue(rng());
}

/** The noise amplitude in 16-bit units: `amount · 65535` (in f32). */
export function noiseAmplitude(amount: number): number {
  return fr(fr(amount) * NOISE_MAX);
}

/** The per-sample delta in 16-bit units: `noise · amt · coverage` (in f32). */
export function noiseDelta(noise: number, amt: number, coverage = 1): number {
  return fr(fr(noise * amt) * coverage);
}

/** Add a delta to a 16-bit channel and quantize like the engine:
 *  `(value + delta).clamp(0, 65535) as u16` — clamp then TRUNCATE toward zero. */
export function applyNoiseChannel(value: number, delta: number): number {
  const sum = fr(value + delta);
  const clamped = sum < 0 ? 0 : sum > NOISE_MAX ? NOISE_MAX : sum;
  return Math.trunc(clamped);
}

export interface NoiseRgb {
  r: number;
  g: number;
  b: number;
}

/** Noise one 16-bit RGB pixel, drawing from `rng` (a uint32 generator). Monochromatic
 *  takes ONE draw shared across the channels (neutrals stay neutral); otherwise three
 *  independent draws. Mirrors the engine's per-pixel draw order. */
export function addNoisePixel(
  rng: () => number,
  r: number,
  g: number,
  b: number,
  amt: number,
  monochromatic: boolean,
  coverage = 1,
): NoiseRgb {
  if (monochromatic) {
    const d = noiseDelta(noiseValue(rng()), amt, coverage);
    return {
      r: applyNoiseChannel(r, d),
      g: applyNoiseChannel(g, d),
      b: applyNoiseChannel(b, d),
    };
  }
  const dr = noiseDelta(noiseValue(rng()), amt, coverage);
  const dg = noiseDelta(noiseValue(rng()), amt, coverage);
  const db = noiseDelta(noiseValue(rng()), amt, coverage);
  return {
    r: applyNoiseChannel(r, dr),
    g: applyNoiseChannel(g, dg),
    b: applyNoiseChannel(b, db),
  };
}

/** Add noise to a flat 16-bit RGBA buffer (length = n·4), returning a fresh buffer.
 *  Mirrors `filters.rs add_noise` at full coverage (whole layer): xorshift32 seeded
 *  `seed | 1`, monochromatic = 1 draw/pixel else 3, alpha copied untouched. */
export function addNoise(
  pixels: ArrayLike<number>,
  amount: number,
  monochromatic: boolean,
  seed: number,
): number[] {
  const out = Array.from(pixels, (v) => v);
  const amt = noiseAmplitude(amount);
  const rng = makeXorshift32(seed);
  const n = Math.floor(out.length / 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const px = addNoisePixel(rng, out[p], out[p + 1], out[p + 2], amt, monochromatic, 1);
    out[p] = px.r;
    out[p + 1] = px.g;
    out[p + 2] = px.b;
    // out[p + 3] (alpha) left untouched
  }
  return out;
}

/** Pack the smart-filter (id 11) params: `[amount, monochromatic ? 1 : 0, seed]`. */
export function packAddNoiseParams(amount: number, monochromatic: boolean, seed: number): number[] {
  return [amount, monochromatic ? 1 : 0, seed];
}

/** Read smart-filter params back into `{ amount, monochromatic, seed }`. The seed is
 *  `Math.fround`-ed before the uint32 coercion because the engine stores params as f32
 *  and reads the seed as `g(2) as u32` — so seeds ≥ 2²⁴ (about half the u32 range) lose
 *  precision identically on both sides, keeping a replayed noise field bit-exact. */
export function unpackAddNoiseParams(params: ArrayLike<number>): {
  amount: number;
  monochromatic: boolean;
  seed: number;
} {
  const at = (i: number): number => (i < params.length ? params[i] : 0);
  return { amount: at(0), monochromatic: at(1) > 0.5, seed: Math.fround(at(2)) >>> 0 };
}
