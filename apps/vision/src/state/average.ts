// ─────────────────────────────────────────────────────────────
// Average (Filter ▸ Blur ▸ Average) — replaces the whole (selected) image with its single mean
// colour. Unlike every neighbourhood filter, this is a GLOBAL reduction: one mean is computed
// over all covered pixels, then every output pixel is set to it. Deterministic; engine-free so
// it unit-tests in node.
//
// The mean is alpha-premultiplied and coverage-weighted, accumulated in **f64** (NOT f32 — this
// is the one place the engine sums in double precision), then divided by the alpha-weighted
// count and cast to f32 before `to16`. Genuinely per channel (no luminance coupling), so a grey
// image (R=G=B=v) is modelled here as one channel: the mean of the channel.
//
// MUST match `filters.rs average` (opaque, full selection ⇒ a=1, cov=1 ⇒ acc[3]=cov_sum=n):
//   for each pixel: sum += v/65535   (f64);  n += 1
//   n == 0 → return unchanged (engine's `cov_sum <= 0` early return)
//   mean = to16((sum / n) as f32);  every output pixel = mean
// where to16(x) = trunc(clamp(x,0,1)·65535 + 0.5), all in f32.
//
// The f64 accumulation is load-bearing: summing v/65535 (each <1) in f32 would drift in the low
// bits and, amplified by ×65535 in to16, shift the result by ≥1 LSB on some fixtures — so the
// sum is kept in plain JS (f64) exactly like the engine. Every other op is +−×÷ or clamp/cast,
// so the result is otherwise bit-exact (no trig, no sqrt).
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const AVERAGE_MAX = 65535;

/** Quantise an f32 fraction in [0,1] to u16 exactly like the engine's `to16` (f32 mul/add, then
 *  a truncating cast). Input is already the f32 mean, so the clamp never binds for valid means. */
function to16(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  const q = fr(fr(c * 65535) + 0.5);
  return Math.trunc(q);
}

/** The single u16 mean that the whole (opaque, fully-selected) grey image averages to:
 *  `to16((Σ v/65535 / n) as f32)`, the sum kept in f64. Returns 0 for an empty image (no pixels;
 *  `average2D` leaves such images untouched rather than painting them). Exposed for testing. */
export function averageValue(image: readonly (readonly number[])[]): number {
  let sum = 0; // f64 accumulation — exactly like the engine's `acc[0]: f64`
  let n = 0;
  for (let y = 0; y < image.length; y++) {
    const row = image[y];
    for (let x = 0; x < row.length; x++) sum += row[x] / 65535;
    n += row.length;
  }
  if (n === 0) return 0;
  return to16(fr(sum / n)); // (sum/n) as f32, then to16
}

/** Apply Average to a single-channel (grey) 2-D image (u16 values 0..65535): every output pixel
 *  becomes the image's mean. An empty image (zero covered pixels) is returned unchanged, matching
 *  the engine's `cov_sum <= 0` early return. Does not mutate the input. */
export function average2D(image: readonly (readonly number[])[]): number[][] {
  const out = image.map((row) => [...row]);
  let n = 0;
  for (let y = 0; y < image.length; y++) n += image[y].length;
  if (n === 0) return out; // no covered pixels → engine returns early (no paint)
  const mean = averageValue(image);
  for (let y = 0; y < out.length; y++) out[y].fill(mean);
  return out;
}
