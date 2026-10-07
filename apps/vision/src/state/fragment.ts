// ─────────────────────────────────────────────────────────────
// Fragment (Filter ▸ Pixelate ▸ Fragment) — the one-click "earthquake" jitter. It
// averages four copies of the image, each shifted to one diagonal corner of a small
// square, so sharp detail is quadrupled into a soft cross. No parameters. Engine-free so
// it unit-tests in node; the sparse-kernel sibling of `boxBlur`.
//
// MUST match `filters.rs fragment`: for each pixel, average the four taps at
// `(x ± OFF, y ± OFF)` (OFF = 4), with edge-clamped coordinates (the engine's `idx`). The
// engine accumulates premultiplied; for fully-opaque pixels (this 1-channel reference's
// domain) that reduces to the plain mean of the four diagonal taps.
//
// This rounds the 4-tap mean; the engine f32-accumulates `src/65535` and writes `to16`,
// so its u16 output can differ by ≤1 LSB (a flat region is exact, since the mean of four
// equal values is that value). Mirrors the `boxBlur.ts` / `mosaicFilter.ts` house style.
// ─────────────────────────────────────────────────────────────

/** The half-size of the square the four copies are spread across (engine `OFF`). */
export const OFF = 4;

/** The four diagonal sample offsets `[ox, oy]` — the corners of a `2·OFF` square. */
export const FRAGMENT_OFFSETS: readonly [number, number][] = [
  [-OFF, -OFF],
  [OFF, -OFF],
  [-OFF, OFF],
  [OFF, OFF],
];

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Apply Fragment to a single-channel 2-D image: each output pixel is the rounded mean of
 *  the four diagonal taps at `(x ± OFF, y ± OFF)`, edge-clamped. Run per channel to
 *  fragment an opaque RGB image, exactly as the engine does. */
export function fragment2D(image: readonly (readonly number[])[]): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (const [ox, oy] of FRAGMENT_OFFSETS) {
        sum += image[clampIdx(y + oy, h - 1)][clampIdx(x + ox, w - 1)];
      }
      row[x] = Math.round(sum / 4); // 4-tap mean (engine f32-accumulates + to16 → ≤1 LSB)
    }
    out.push(row);
  }
  return out;
}
