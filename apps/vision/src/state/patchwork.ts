// ─────────────────────────────────────────────────────────────
// Patchwork (Filter ▸ Texture ▸ Patchwork) — tiles the image into square patches, fills each with
// its AVERAGE colour, then embosses a bevel so the patches look raised: the top-left of every
// tile is lightened and the bottom-right darkened, more so for brighter tiles. Deterministic;
// engine-free so it unit-tests in node.
//
// The bevel is scaled by the tile's LUMINANCE (Rec.601), and the average + shade apply per
// channel, so a grey image (R=G=B) matches `patchwork` bit-for-bit — modelled here as one channel.
// Like `average`, the per-cell mean accumulates in **f64** (a cell can hold > 2²⁴ summed value).
//
// MUST match `filters.rs patchwork` (full selection ⇒ cov 1):
//   s = max(size,2);  rel = clamp(relief,0,1);  cols = ceil(W/s);  denom = max(s-1, 1)
//   pass 1: per cell (⌊x/s⌋, ⌊y/s⌋) accumulate Σ value (f64) and the pixel count n
//   pass 2 per pixel:
//     A = (Σ/n) as f32                                   (the cell average)
//     fx = (x mod s)/denom;  fy = (y mod s)/denom        (position within the tile, 0..1)
//     bright = (A·0.299 + A·0.587 + A·0.114) / 65535
//     shade  = ((0.5−fx) + (0.5−fy))·rel·bright·65535    (+ at top-left, − at bottom-right)
//     out = clamp(A + shade, 0, 65535)
//     px  = clamp(v + (out − v)·cov, 0, 65535) as u16    (cov=1 ⇒ out; TRUNCATES)
//
// relief 0 ⇒ shade 0 ⇒ a pure block-average mosaic. Fully bit-exact: the f64 cell sum matches the
// engine's `f64` accumulator, and every other op is + − × ÷ or a clamp/cast (no trig, no sqrt);
// `Math.fround` per sub-op reproduces the engine's f32 order.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const PATCHWORK_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampU16 = (x: number): number => (x < 0 ? 0 : x > PATCHWORK_MAX ? PATCHWORK_MAX : x);

/** The bevel shade (an f32 offset, signed) for tile-position `(fx, fy)` ∈ [0,1]² and cell average
 *  `a`, given `rel`. Positive (lighter) at the top-left, negative (darker) at the bottom-right.
 *  Exposed for testing. */
export function patchworkShade(fx: number, fy: number, a: number, rel: number): number {
  const bright = fr(fr(fr(fr(a * C_R) + fr(a * C_G)) + fr(a * C_B)) / 65535);
  const pos = fr(fr(0.5 - fx) + fr(0.5 - fy));
  return fr(fr(fr(pos * rel) * bright) * 65535);
}

/** Apply Patchwork to a single-channel (grey) 2-D image (u16 values 0..65535). `size` is the tile
 *  size (≥2), `relief` ∈ [0,1] the bevel depth. Does not mutate the input. */
export function patchwork2D(image: readonly (readonly number[])[], size: number, relief: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  const s = Math.max(Math.trunc(size), 2);
  const rel = clamp01(fr(relief));
  const cols = Math.floor((w + s - 1) / s);
  const rows = Math.floor((h + s - 1) / s);
  const denom = Math.max(fr(s - 1), 1);
  // pass 1: per-cell f64 sum + count (exactly like the engine's f64 accumulator)
  const sum = new Array<number>(cols * rows).fill(0);
  const cnt = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = Math.floor(y / s) * cols + Math.floor(x / s);
      sum[cell] += image[y][x];
      cnt[cell] += 1;
    }
  }
  // pass 2: render the cell average + bevel shade
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = Math.floor(y / s) * cols + Math.floor(x / s);
      const n = Math.max(cnt[cell], 1);
      const a = fr(sum[cell] / n); // (Σ/n) as f32
      const fx = fr((x % s) / denom);
      const fy = fr((y % s) / denom);
      const shade = patchworkShade(fx, fy, a, rel);
      const outVal = clampU16(fr(a + shade));
      const v = image[y][x];
      const blended = fr(v + fr(outVal - v)); // cov = 1 (full selection)
      out[y][x] = Math.trunc(clampU16(blended));
    }
  }
  return out;
}
