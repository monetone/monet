// ─────────────────────────────────────────────────────────────
// Mosaic / Pixelate (Filter ▸ Pixelate ▸ Mosaic) — tile the image into
// `size × size` cells and flood-fill each cell with its own average colour, the
// classic blocky "censor-bar" pixelation. Engine-free so it unit-tests in node.
//
// MUST match `filters.rs mosaic`: step the image in `size`-pixel blocks; for each
// block average the pixels it covers and paint the whole block that average. The
// engine averages in *premultiplied* space so a block straddling a transparent
// edge keeps the content's colour; for fully-opaque pixels (the case this 1-channel
// reference covers) that reduces to the plain per-channel mean. Blocks at the right/
// bottom edges are clipped to the image (`(by+size).min(h)`, `(bx+size).min(w)`) and
// so average fewer pixels. `size < 2` is a no-op.
//
// This is the 8-bit reference: it rounds each block mean to an integer (round-half-
// up, like Photoshop). On opaque data the block *mean* is computed exactly; note the
// engine carries the mean through `to16` (16-bit) and its `u16_to_8` display/export
// conversion *truncates* (`v >> 8`) rather than rounds, so the engine's 8-bit read-
// back can still differ from this round-half-up reference by ≤1 LSB (this reference
// is the more faithful Photoshop quantizer). Partially-transparent blocks diverge
// further via the premultiplied path. Mirrors the `medianFilter.ts` state-module style.
// ─────────────────────────────────────────────────────────────

/** The block fill value: the rounded mean of the cell's samples (round-half-up,
 *  matching the engine's `to16`/8-bit quantization on opaque data). Empty → 0. */
export function blockMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return Math.round(sum / values.length);
}

/** Apply Mosaic to a single-channel 2-D image (rows of values). Each `size × size`
 *  cell — clipped at the right/bottom edges — is flood-filled with its rounded mean.
 *  `size < 2` (and a NaN size) returns an unchanged copy. Run it per channel to
 *  pixelate an opaque RGB image, exactly as the engine does. */
export function mosaic2D(image: readonly (readonly number[])[], size: number): number[][] {
  const s = Math.trunc(size);
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  // `!(s >= 2)` rather than `s < 2` so a NaN size is treated as the no-op too.
  if (!(s >= 2) || w === 0) return image.map((row) => [...row]);
  const out = image.map((row) => [...row]);
  for (let by = 0; by < h; by += s) {
    const y1 = Math.min(by + s, h);
    for (let bx = 0; bx < w; bx += s) {
      const x1 = Math.min(bx + s, w);
      let sum = 0;
      let cnt = 0;
      for (let y = by; y < y1; y++) {
        const srcRow = image[y];
        for (let x = bx; x < x1; x++) {
          sum += srcRow[x];
          cnt++;
        }
      }
      const val = Math.round(sum / cnt); // inline `blockMean` — avoids a per-block array
      for (let y = by; y < y1; y++) {
        const dstRow = out[y];
        for (let x = bx; x < x1; x++) dstRow[x] = val;
      }
    }
  }
  return out;
}
