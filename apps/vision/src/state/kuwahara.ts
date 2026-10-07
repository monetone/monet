// ─────────────────────────────────────────────────────────────
// Kuwahara (a classic edge-preserving smoothing filter; Photoshop ships it as part of the
// Oil Paint / stylize family) — smooths flat areas while keeping edges crisp. For each pixel it
// looks at FOUR overlapping square quadrant regions that all share the centre pixel, measures the
// variance of each, and outputs the MEAN of whichever region is most uniform (lowest variance).
// Because the chosen region never straddles an edge, edges survive while noise is averaged away.
// Deterministic; engine-free so it unit-tests in node.
//
// The region SELECTION is driven by the variance SUMMED over the three colour channels, so on a
// grey image (R=G=B=v) the three per-channel terms are identical and the sum is `fr(3·term)`;
// modelled here as one channel that reproduces that 3-fold accumulation so the arg-min matches
// `kuwahara` bit-for-bit. The output is the region mean, TRUNCATED to u16 (the engine's `as u16`).
//
// MUST match `filters.rs kuwahara` (full selection ⇒ cov 1):
//   radius < 1 → identity (engine early return)
//   quads = [(-r..0,-r..0), (0..r,-r..0), (-r..0,0..r), (0..r,0..r)]   (each (r+1)² px, edge-clamped)
//   per quad: sum=Σv, sq=Σ(v·v)  (f32, v·v can exceed 2²⁴ so each square rounds); n=(r+1)²
//             mean = sum/n;  term = sq/n − mean·mean;  var = term+term+term  (≡ engine's 3 channels)
//   pick the quad with the SMALLEST var (strict `<`, so the first quad wins ties)
//   out = trunc(clamp(best_mean, 0, 65535))
//
// Fully bit-exact for grey input: every op is + − × ÷ or a clamp/compare — innocuous under
// f64→f32 double rounding (no trig, no sqrt). `Math.fround` per sub-op reproduces the engine's f32
// order; the arg-min is a HARD decision, so the exact f32 variance (incl. the 3-fold sum) matters.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const KUWAHARA_MAX = 65535;

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Quadrant regions as `[x0, x1, y0, y1]` offsets from the centre (inclusive), each (r+1)×(r+1)
 *  and all sharing the centre pixel. `r` is substituted at call time. */
const QUAD_SIGNS: readonly (readonly [number, number, number, number])[] = [
  [-1, 0, -1, 0], // top-left
  [0, 1, -1, 0], // top-right
  [-1, 0, 0, 1], // bottom-left
  [0, 1, 0, 1], // bottom-right
];

/** The Kuwahara output for a single (grey/luminance) pixel `(x, y)`: the mean of the lowest-
 *  variance quadrant region. Exposed for isolated testing. Precondition: `image` non-empty and
 *  `(x,y)` in bounds (`kuwahara2D` guarantees this). */
export function kuwaharaPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  radius: number,
): number {
  const orig = image[y][x];
  const r = Math.trunc(radius);
  if (r < 1) return orig; // radius < 1 → identity (engine early return)
  const h = image.length;
  const w = image[0].length;
  let bestVar = Infinity; // engine seeds f32::MAX; the first (finite-var) quad always wins it
  let bestMean = 0;
  for (const [sx0, sx1, sy0, sy1] of QUAD_SIGNS) {
    const x0 = sx0 * r;
    const x1 = sx1 * r;
    const y0 = sy0 * r;
    const y1 = sy1 * r;
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const v = image[clampIdx(y + yy, h - 1)][clampIdx(x + xx, w - 1)];
        sum = fr(sum + v);
        sq = fr(sq + fr(v * v)); // v·v can exceed 2²⁴ → rounds in f32, like the engine
        n = fr(n + 1); // engine counts n in f32; matters only at radius ≥ 4096 (n > 2²⁴), but kept faithful
      }
    }
    const mean = fr(sum / n);
    const term = fr(fr(sq / n) - fr(mean * mean));
    // engine accumulates `term` across the 3 (identical, for grey) channels: var = fr(3·term)
    let varSum = fr(0 + term);
    varSum = fr(varSum + term);
    varSum = fr(varSum + term);
    if (varSum < bestVar) {
      bestVar = varSum;
      bestMean = mean;
    }
  }
  const c = bestMean < 0 ? 0 : bestMean > KUWAHARA_MAX ? KUWAHARA_MAX : bestMean;
  return Math.trunc(c); // `as u16` truncates (mean ≥ 0)
}

/** Apply Kuwahara to a single-channel (grey) 2-D image (u16 values 0..65535). Does not mutate
 *  the input. radius < 1 is a no-op (engine early return). */
export function kuwahara2D(image: readonly (readonly number[])[], radius: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  if (Math.trunc(radius) < 1) return out; // no-op
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = kuwaharaPixel(image, x, y, radius);
    }
  }
  return out;
}
