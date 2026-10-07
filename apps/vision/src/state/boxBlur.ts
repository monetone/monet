// ─────────────────────────────────────────────────────────────
// Box Blur (Filter ▸ Blur ▸ Box Blur) — average each pixel with its `(2r+1)×(2r+1)`
// square neighbourhood (a uniform/flat kernel, unlike Gaussian's bell weighting).
// Engine-free so it unit-tests in node; the continuous moving-average sibling of
// `gaussianKernel` / `convolve1D`.
//
// MUST match `filters.rs box_blur`: `radius < 1` is a no-op; otherwise average the
// `(2r+1)²` window with edge-clamped coordinates (the engine's `idx` replicates the
// border), dividing by the FIXED area `(2r+1)²` (edge windows still have `area`
// samples because clamping repeats the edge pixel). The engine averages in
// *premultiplied* space so transparent neighbours add no colour; for fully-opaque
// pixels (the case this 1-channel reference covers) that reduces to the plain mean.
//
// This returns the continuous window mean (like `convolve1D`); an 8-bit render rounds
// it via `byte()` (round-half-up), which matches the engine's u16 (`to16`) path to ≤1
// LSB. A box blur is separable: a horizontal 1-D pass followed by a vertical 1-D pass
// equals the direct 2-D mean (`boxBlurSeparable` ≡ `boxBlur2D`). Mirrors the
// `gaussianKernel.ts` / `medianFilter.ts` state-module house style.
// ─────────────────────────────────────────────────────────────

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Box-blur a 1-D signal: replace each sample with the mean of `[i−r, i+r]`, using
 *  edge-clamped indices and dividing by the window size `2r+1`. `radius < 1` (and a
 *  NaN radius) returns an unchanged copy. */
export function boxBlur1D(signal: readonly number[], radius: number): number[] {
  const r = Math.trunc(radius);
  const n = signal.length;
  // `!(r >= 1)` rather than `r < 1` so a NaN radius is treated as the no-op too.
  if (!(r >= 1) || n === 0) return signal.map((v) => v);
  const win = 2 * r + 1;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += signal[clampIdx(i + k, n - 1)];
    out[i] = sum / win;
  }
  return out;
}

/** Box-blur a single-channel 2-D image directly: each output is the mean of the
 *  `(2r+1)²` edge-clamped window divided by the fixed area. `radius < 1` (and NaN)
 *  returns an unchanged copy. Run per channel to blur an opaque RGB image, exactly as
 *  the engine does. */
export function boxBlur2D(image: readonly (readonly number[])[], radius: number): number[][] {
  const r = Math.trunc(radius);
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (!(r >= 1) || w === 0) return image.map((row) => [...row]);
  const area = (2 * r + 1) * (2 * r + 1);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        const srcRow = image[clampIdx(y + dy, h - 1)];
        for (let dx = -r; dx <= r; dx++) sum += srcRow[clampIdx(x + dx, w - 1)];
      }
      row[x] = sum / area;
    }
    out.push(row);
  }
  return out;
}

/** Box-blur a 2-D image as two separable 1-D passes — horizontal (`boxBlur1D` on each
 *  row) then vertical (`boxBlur1D` down each column). Mathematically identical to
 *  `boxBlur2D` (the uniform kernel is separable); kept as a reference for the
 *  separability property and the basis of the engine's fast path. */
export function boxBlurSeparable(image: readonly (readonly number[])[], radius: number): number[][] {
  const r = Math.trunc(radius);
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (!(r >= 1) || w === 0) return image.map((row) => [...row]);
  // Horizontal pass: blur every row.
  const hBlur = image.map((row) => boxBlur1D(row, radius));
  // Vertical pass: blur every column (gather the column, blur it, scatter back).
  const out: number[][] = Array.from({ length: h }, () => new Array<number>(w));
  for (let x = 0; x < w; x++) {
    const col = new Array<number>(h);
    for (let y = 0; y < h; y++) col[y] = hBlur[y][x];
    const blurred = boxBlur1D(col, radius);
    for (let y = 0; y < h; y++) out[y][x] = blurred[y];
  }
  return out;
}
