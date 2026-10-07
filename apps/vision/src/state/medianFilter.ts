// ─────────────────────────────────────────────────────────────
// Median filter (Filter ▸ Noise ▸ Median) — replace each pixel with the median of
// its `(2r+1)×(2r+1)` neighbourhood (per channel). Excellent at removing salt-and-
// pepper noise while keeping edges sharp (unlike a blur, it introduces no new
// values). Engine-free so it unit-tests in node.
//
// MUST match `filters.rs median` + `idx`: per channel, gather the `(2r+1)²` window
// with edge-clamped coordinates (`idx` clamps x/y to the image bounds), sort
// ascending, and take `window[len/2]` (the exact middle of the odd-length window).
// `radius < 1` is a no-op. Median is an order statistic on integers, so it is exact
// — no float/quantization concerns. Mirrors the `*.ts` state-module house style.
// ─────────────────────────────────────────────────────────────

/** The median of a set of values — the `len/2`-th element of the ascending sort
 *  (the exact middle for the odd-length windows this filter uses; the upper-middle
 *  for even lengths, matching the engine's `window[len/2]`). */
export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Apply the median filter to a single-channel 2-D image (rows of values) with the
 *  engine's edge-clamped `(2r+1)²` window. `radius < 1` returns a copy unchanged.
 *  Run it per channel to filter an RGB image, exactly as the engine does. */
export function median2D(image: readonly (readonly number[])[], radius: number): number[][] {
  const r = Math.trunc(radius);
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  // `!(r >= 1)` rather than `r < 1` so a NaN radius is treated as the no-op too.
  if (!(r >= 1) || w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = new Array(w);
    for (let x = 0; x < w; x++) {
      const window: number[] = [];
      for (let dy = -r; dy <= r; dy++) {
        const cy = clampIdx(y + dy, h - 1);
        const srcRow = image[cy];
        for (let dx = -r; dx <= r; dx++) {
          window.push(srcRow[clampIdx(x + dx, w - 1)]);
        }
      }
      row[x] = medianOf(window);
    }
    out.push(row);
  }
  return out;
}
