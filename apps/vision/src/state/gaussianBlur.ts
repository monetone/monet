// ─────────────────────────────────────────────────────────────
// Gaussian Blur (Filter ▸ Blur ▸ Gaussian Blur) — the classic separable Gaussian blur: a 1-D
// normalised Gaussian kernel is convolved horizontally then vertically (edge-clamped), working in
// PREMULTIPLIED alpha so transparent edges don't bleed dark. Deterministic; engine-free so it
// unit-tests in node.
//
// Modelled as a single grey channel on an OPAQUE image (alpha = 65535 ⇒ a = 1): premultiplying is a
// no-op on the value, but the alpha channel is still blurred and divided back out, so the value is
// convolved and then divided by the (constant) blurred alpha — exactly as `gaussian_blur` does for a
// grey opaque image.
//
// MUST match `filters.rs gaussian_blur` + `gaussian_kernel` (grey, opaque, full selection ⇒ copy):
//   radius < 0.1 ⇒ no-op
//   r = ceil(max(radius,0));  r<1 ⇒ kernel [1];  sigma = max(radius/2, 0.5)
//   k[i] = exp(−i²/(2σ²)) for i∈[−r,r], then k[i] /= Σk   (all f32)
//   premult: pmv = v/65535·a (a=1);  conv H then V with f32 accumulation, taps clamped to the edge
//   unpremult: out_v / out_a;  to16(x) = ⌊clamp(x,0,1)·65535 + 0.5⌋
//
// Every op is f32 via `Math.fround` per sub-op EXCEPT the Gaussian weights, where `f32::exp` and JS
// `fround(Math.exp)` can disagree by ≤1 ULP for some `i` (e.g. radius 1.08 differs at two taps). That
// ≤1-ULP weight shift is normally ABSORBED by the output quantisation — every golden below (including
// radius 1.08) is bit-exact — but in principle it could shift a quantised output by ≤1 LSB, so this is
// bit-exact-to-≤1, not provably strict for all radii. (The deployed engine is a WASM build, whose libm
// `expf` may also differ from the native `expf` the goldens were captured with — a second ≤1 source.)
// The f32 ACCUMULATION order (horizontal pass then vertical, kernel left-to-right) matches the engine.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const GAUSSIAN_BLUR_MAX = 65535;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampInt = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
/** `to16` — `(clamp(x,0,1)·65535 + 0.5) as u16` (round half-up, saturating). */
const to16 = (x: number): number => {
  const v = fr(fr(clamp01(x) * 65535) + 0.5);
  return v >= 65535 ? 65535 : Math.trunc(v);
};

/** The normalised 1-D Gaussian kernel for `radius`, in f32: `{ weights (sum≈1), r }`. `r<1` gives the
 *  single-tap identity. Exposed for testing. */
export function gaussianBlurKernel(radius: number): { weights: number[]; r: number } {
  const rad = fr(radius);
  const r = Math.ceil(rad > 0 ? rad : 0); // Rust `f32::max(radius, 0)`: NaN and ≤0 both → 0 (a NaN radius ⇒ identity)
  // `r < 1` covers ≤0/NaN (→ identity); `!Number.isFinite(r)` guards an Infinity radius (the engine
  // would overflow to a degenerate kernel; the mirror safely returns identity instead of looping forever).
  if (!(r >= 1) || !Number.isFinite(r)) return { weights: [1], r: 0 };
  const sigma = Math.max(fr(fr(radius) / 2), 0.5);
  const denom = fr(2 * fr(sigma * sigma));
  const weights: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = fr(Math.exp(fr(-fr(i * i) / denom)));
    weights.push(v);
    sum = fr(sum + v);
  }
  for (let i = 0; i < weights.length; i++) weights[i] = fr(weights[i] / sum);
  return { weights, r };
}

/** Convolve one row/column of an f32 field at output index `p` with the kernel, edge-clamped to
 *  `[0, len)`. `at(j)` reads the field sample at clamped index `j`. f32 accumulation. */
function convAt(at: (j: number) => number, p: number, len: number, weights: readonly number[], r: number): number {
  let acc = 0;
  for (let ki = 0; ki < weights.length; ki++) {
    const j = clampInt(p + ki - r, len - 1);
    acc = fr(acc + fr(at(j) * weights[ki]));
  }
  return acc;
}

/** Apply Gaussian Blur to a single-channel (grey, opaque) 2-D image (u16 values 0..65535). `radius`
 *  < 0.1 is a no-op. Does not mutate the input. */
export function gaussianBlur2D(image: readonly (readonly number[])[], radius: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0 || fr(radius) < 0.1) return image.map((row) => [...row]);
  const { weights, r } = gaussianBlurKernel(radius);

  // alpha is all-1 (opaque) ⇒ both passes produce a constant; compute the blurred alpha once.
  const ha = convAt(() => 1, 0, Math.max(w, h), weights, r); // horizontal pass of all-1
  const oa = convAt(() => ha, 0, Math.max(w, h), weights, r); // vertical pass of the constant ha

  // premultiplied value field (a = 1 ⇒ pmv = v/65535)
  const pmv = image.map((row) => row.map((v) => fr(v / 65535)));

  // horizontal pass
  const tmp: number[][] = pmv.map((row, y) => row.map((_, x) => convAt((j) => pmv[y][j], x, w, weights, r)));
  // vertical pass, then unpremultiply by the blurred alpha and quantise
  return tmp.map((row, y) =>
    row.map((_, x) => {
      const outv = convAt((j) => tmp[j][x], y, h, weights, r);
      return oa > 1e-4 ? to16(fr(outv / oa)) : 0;
    }),
  );
}
