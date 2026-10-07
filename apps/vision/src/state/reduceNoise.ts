// ─────────────────────────────────────────────────────────────
// Reduce Noise (Filter ▸ Noise ▸ Reduce Noise) — edge-preserving BILATERAL smoothing. Each output
// pixel is a weighted average of its 5×5 neighbourhood (radius 2) where the weight falls off with
// BOTH spatial distance (a fixed Gaussian, sigma_s = 2) AND colour difference (sigma_c widens with
// `strength`), so flat noise is smoothed while real edges — large colour jumps — survive. Unlike the
// linear box / Gaussian blurs (which average regardless of content) or the rank median / despeckle,
// the weight is data-dependent. Engine-free so it unit-tests in node.
//
// Modelled as a single grey channel (R=G=B). The engine computes the colour distance over all three
// channels, dc = (Δr)²+(Δg)²+(Δb)², which for a grey pixel is 3·(Δv)² — and it accumulates each
// channel identically, so the grey value channel alone reproduces the engine's R=G=B output exactly.
//
// MUST match `filters.rs reduce_noise` (grey, full selection ⇒ blend_back is a copy):
//   radius = 2;  sigma_s = 2;  sigma_c = 0.04 + clamp(strength,0,1)·0.20   (all f32)
//   inv2s2 = 1/(2·sigma_s²) = 0.125;  inv2c2 = 1/(2·sigma_c²)
//   cv = v_center/65535;  per tap (edge-clamped) sv = v_tap/65535:
//     dc = (sv−cv)² + (sv−cv)² + (sv−cv)²        ← three f32 terms summed left-to-right
//     ds = (dx²+dy²) as f32
//     w  = exp(−ds·inv2s2 − dc·inv2c2)
//     acc += sv·w;  wsum += w                     ← f32 accumulation, dy outer / dx inner
//   out = round(acc/wsum · 65535)  (round half away from zero), clamped to [0,65535]
//
// Every op is f32 via `Math.fround` per sub-op EXCEPT the exp weight: the engine's f32::exp (libm
// expf) and JS `fround(Math.exp)` can disagree by ≤1 ULP, which can shift a quantised output by ≤1
// LSB. So this is bit-exact-to-≤1; every golden below sits at an exact point (verified against the
// engine). (The deployed engine is a WASM build whose libm `expf` may also differ from the native
// `expf` the goldens were captured with — a second ≤1 source.) The f32 accumulation order (dy outer,
// dx inner) matches the engine, so the weighted sums are bit-identical given equal exp terms.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const REDUCE_NOISE_MAX = 65535;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampInt = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
/** `(round(x).clamp(0,65535)) as u16` — round HALF AWAY FROM ZERO (Rust `f32::round`; x ≥ 0 here so
 *  this is round-half-up), saturating, NaN ⇒ 0 (a NaN strength propagates to an all-zero result). The
 *  only reachable non-finite input is NaN: acc/wsum ≤ 1 (sv ≤ 1, wgt ≤ 1) and wsum ≥ 1 (the center tap
 *  weight is exp(0)=1), so x ∈ [0, 65535] is always finite for real input and ±Inf never arises. */
const toU16 = (x: number): number => {
  if (!Number.isFinite(x)) return 0;
  const r = x < 0 ? -Math.round(-x) : Math.round(x);
  return r < 0 ? 0 : r > 65535 ? 65535 : r;
};

/** The colour sigma for `strength`, in f32: `0.04 + clamp(strength,0,1)·0.20`. Exposed for testing. */
export function reduceNoiseSigmaC(strength: number): number {
  return fr(fr(0.04) + fr(clamp01(fr(strength)) * fr(0.2)));
}

/** Apply Reduce Noise to a single-channel (grey) 2-D image (u16 values 0..65535). Does not mutate
 *  the input. `strength` is clamped to [0,1]. */
export function reduceNoise2D(image: readonly (readonly number[])[], strength: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const radius = 2;
  const sigmaS = fr(2);
  const sigmaC = reduceNoiseSigmaC(strength);
  const inv2s2 = fr(1 / fr(2 * fr(sigmaS * sigmaS))); // = 0.125
  const inv2c2 = fr(1 / fr(2 * fr(sigmaC * sigmaC)));

  return image.map((row, y) =>
    row.map((_, x) => {
      const cv = fr(image[y][x] / 65535);
      let acc = 0;
      let wsum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = clampInt(x + dx, w - 1);
          const sy = clampInt(y + dy, h - 1);
          const sv = fr(image[sy][sx] / 65535);
          const d = fr(sv - cv);
          const d2 = fr(d * d);
          const dc = fr(fr(d2 + d2) + d2); // (Δr)²+(Δg)²+(Δb)² for grey = three equal f32 terms
          const ds = fr(dx * dx + dy * dy);
          const arg = fr(fr(-ds * inv2s2) - fr(dc * inv2c2));
          const wgt = fr(Math.exp(arg));
          acc = fr(acc + fr(sv * wgt)); // f32 accumulation — the engine's `acc: [f32;3]` (f64 here diverges, e.g. ≤1 LSB)
          wsum = fr(wsum + wgt); // f32 accumulation — the engine's `wsum: f32`
        }
      }
      return toU16(fr(fr(acc / wsum) * 65535));
    }),
  );
}
