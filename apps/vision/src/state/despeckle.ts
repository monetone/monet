// ─────────────────────────────────────────────────────────────
// Despeckle (Filter ▸ Noise ▸ Despeckle) — a one-click edge-preserving blur. It smooths
// flat, low-contrast noise (a 3×3 average) but leaves real edges untouched, so detail
// stays crisp while speckle is softened. Engine-free so it unit-tests in node.
//
// MUST match `filters.rs despeckle`:
//   EDGE = 38·257 ≈ 0.15 of full range (the noise-vs-edge cutoff, in u16).
//   For each pixel, edge = max over its 4-connected neighbours (up/down/left/right,
//   edge-clamped) of the absolute channel difference. If edge ≥ EDGE the pixel is a real
//   edge → keep the original; otherwise replace it with the 3×3 edge-clamped mean.
//   The engine accumulates premultiplied; for fully-opaque pixels (this 1-channel
//   reference's domain) that reduces to the plain mean over the 9 taps.
//
// The edge decision is pure INTEGER math (u16 `abs_diff`, `max`, `≥`), so the keep-vs-blur
// branch is reproduced exactly. The engine computes the edge as the max across ALL three
// RGB channels (a pixel is preserved if ANY channel jumps); for a single channel that is
// just `|center − neighbour|`, so this is exact on grayscale. The blurred value rounds the
// 3×3 mean; the engine f32-accumulates `src/65535` and writes `to16`, so its u16 output can
// differ by ≤1 LSB on blurred pixels (kept pixels are bit-exact). Mirrors the `boxBlur.ts`
// / `medianFilter.ts` state-module house style.
// ─────────────────────────────────────────────────────────────

/** The edge threshold in 16-bit units (`38·257` = 9766 ≈ 0.15 of 65535). A neighbour
 *  difference at or above this marks a real edge that despeckle leaves unblurred. */
export const EDGE = 38 * 257;
/** The same cutoff in 8-bit units (38 levels), for reference. */
export const EDGE_8BIT = 38;

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The despeckle edge metric at `(x, y)`: the maximum absolute difference between the
 *  pixel and its 4-connected, edge-clamped neighbours (up/down/left/right). Integer and
 *  exact. Diagonal neighbours do NOT count. (The engine takes the max across all 3 RGB
 *  channels; on a single channel this is `max|center − neighbour|`.) */
export function edgeAt(image: readonly (readonly number[])[], x: number, y: number): number {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return 0; // a degenerate image has no neighbours → no edge
  const c = image[y][x];
  let edge = 0;
  const neighbours: [number, number][] = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
  for (const [nx, ny] of neighbours) {
    const d = Math.abs(c - image[clampIdx(ny, h - 1)][clampIdx(nx, w - 1)]);
    if (d > edge) edge = d;
  }
  return edge;
}

/** Apply Despeckle to a single-channel 2-D image (u16 values 0..65535): pixels whose
 *  edge metric is ≥ `EDGE` are kept as-is (real edges), the rest are replaced by the
 *  rounded 3×3 edge-clamped mean (smoothing flat noise). Run per channel to despeckle an
 *  opaque RGB image (note the engine's edge decision couples the channels — see header). */
export function despeckle2D(image: readonly (readonly number[])[]): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      if (edgeAt(image, x, y) >= EDGE) {
        row[x] = image[y][x]; // a real edge — keep the original (bit-exact)
        continue;
      }
      let sum = 0;
      for (let ny = y - 1; ny <= y + 1; ny++) {
        const srcRow = image[clampIdx(ny, h - 1)];
        for (let nx = x - 1; nx <= x + 1; nx++) sum += srcRow[clampIdx(nx, w - 1)];
      }
      row[x] = Math.round(sum / 9); // 3×3 mean (engine f32-accumulates + to16 → ≤1 LSB)
    }
    out.push(row);
  }
  return out;
}
