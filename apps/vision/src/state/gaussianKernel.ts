// ─────────────────────────────────────────────────────────────
// Gaussian Blur kernel (Filter ▸ Blur ▸ Gaussian Blur) — the 1-D separable weight
// kernel. The engine builds this once and convolves it horizontally then
// vertically (with edge clamping). Engine-free so it unit-tests in node.
//
// MUST match `filters.rs gaussian_kernel`: `r = ceil(max(radius, 0))`; `r < 1`
// yields the single-tap identity `[1]`; `sigma = max(radius/2, 0.5)`; the `2r+1`
// taps are `exp(-i²/2σ²)` for `i ∈ [-r, r]`, normalised to sum 1. The engine runs
// this in f32; here it is f64 (the weights feed a convolution that quantizes at the
// output, so the difference stays sub-LSB at the quantized output — like the other
// reference modules; there is no hard compare to diverge).
// Mirrors the `*.ts` state-module house style.
// ─────────────────────────────────────────────────────────────

export interface GaussianKernel {
  /** The `2·radius + 1` normalised weights (sum 1), centre at index `radius`. */
  weights: number[];
  /** The kernel half-width `r` (the engine's second return value). */
  radius: number;
}

/** Build the normalised 1-D Gaussian kernel for a blur `radius`. A radius ≤ 0
 *  yields the identity kernel `{ weights: [1], radius: 0 }`. */
export function gaussianKernel(radius: number): GaussianKernel {
  const r = Math.ceil(Math.max(radius, 0));
  if (r < 1) return { weights: [1], radius: 0 };
  const sigma = Math.max(radius / 2, 0.5);
  const weights: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights.push(v);
    sum += v;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  return { weights, radius: r };
}

/** Convolve a 1-D signal with a Gaussian kernel using edge clamping (replicate the
 *  boundary), exactly as one of the engine's separable passes does for opaque
 *  pixels: `out[x] = Σ signal[clamp(x + ki − r, 0, n−1)] · weights[ki]`. */
export function convolve1D(signal: readonly number[], kernel: GaussianKernel): number[] {
  const { weights, radius } = kernel;
  const n = signal.length;
  const out = new Array<number>(n);
  const last = n - 1;
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let ki = 0; ki < weights.length; ki++) {
      let sx = x + ki - radius;
      if (sx < 0) sx = 0;
      else if (sx > last) sx = last;
      acc += signal[sx] * weights[ki];
    }
    out[x] = acc;
  }
  return out;
}
