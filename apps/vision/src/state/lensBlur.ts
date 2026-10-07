// ─────────────────────────────────────────────────────────────
// Lens Blur (Filter ▸ Blur ▸ Lens Blur) — a circular-aperture (bokeh) blur with highlight
// bloom. Unlike the box / Gaussian blurs (which average linearly), Lens Blur averages in a
// GAMMA-EXPANDED domain so bright highlights bloom into a disc the way a real lens does:
// every pixel inside the radius-`r` disc is raised to the power `g`, the disc is averaged,
// and the mean is raised back to `1/g`. `brightness` 0..1 sets the bloom exponent
// (g = 1 + brightness·4, so g ∈ [1,5]); at brightness 0 (g = 1) it degrades to a plain
// circular-disc average. Engine-free so it unit-tests in node.
//
// MUST match `filters.rs lens_blur` (grey single channel, full selection ⇒ blend_back is a copy):
//   radius = clamp(radius, 1, 20)  (i32);  disc = { (dx,dy) : dx²+dy² ≤ radius² }, generated
//     dy = −r..=r (outer), dx = −r..=r (inner)  — this fixes the f64 accumulation order.
//   g = 1 + clamp(brightness, 0, 1)·4   (f32);   inv_g = 1 / (g as f64);   n = |disc|
//   per pixel:  acc = Σ_disc (src(x+dx, y+dy) / 65535)^g    — f64 accumulation, edge-clamped taps
//               out = round( (acc / n)^inv_g · 65535 )  clamped to [0, 65535]
//   alpha is unchanged for an opaque image: acc_a = n·65535 ⇒ acc_a/n = 65535 (stays opaque).
//
// NUMERIC MODEL — the OPPOSITE of the Gaussian blur's f32 discipline. The engine accumulates
// in f64 (`acc: [f64; 4]`) using `powf`, so this mirror uses plain JS doubles (NO `Math.fround`)
// for the per-pixel math and `Math.pow`. The accumulation order matches the engine, so the f64
// sums are bit-identical PROVIDED each `powf` term matches. The ONE caveat: Rust's `f64::powf`
// (native libm `pow`) and JS `Math.pow` (V8 fdlibm `pow`) are each only ≤1-ULP accurate and can
// disagree in the last bit; a ≤1-ULP term shift can move a quantised output by ≤1 LSB. So this is
// bit-exact-to-≤1, not provably strict for all inputs — every golden below sits at an exact point
// (verified against the engine). (The deployed engine is a WASM build whose libm `pow` may also
// differ from the native `pow` the goldens were captured with — a second ≤1 source.) Only `g` and
// `inv_g` use f32/f64 widening exactly as the engine does (g is computed in f32, then `as f64`).
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const LENS_BLUR_MAX = 65535;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Edge-replicate clamp of a tap index to `[0, hi]` — the engine's `idx`. */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
/** `(round(x).clamp(0,65535)) as u16` — round half-up (x ≥ 0 here), saturating, NaN ⇒ 0. The only
 *  reachable non-finite input is NaN (a NaN brightness ⇒ g = NaN ⇒ pow = NaN); for the u16 image domain
 *  the power-mean is always in [0, 65535], so ±Inf never arises (and Rust would saturate +Inf → 65535). */
const toU16 = (x: number): number => {
  if (!Number.isFinite(x)) return 0; // Rust `NaN as u16` = 0
  const r = Math.round(x);
  return r < 0 ? 0 : r > 65535 ? 65535 : r;
};

/** The lens-blur disc offsets for `radius` (clamped to [1,20]), in the engine's generation order
 *  (dy outer, dx inner). Exposed for testing the aperture shape. */
export function lensBlurDisc(radius: number): { offsets: ReadonlyArray<readonly [number, number]>; r: number } {
  // `radius: i32` at the wasm boundary ⇒ ToInt32, then clamp [1,20]. `| 0` IS ToInt32 (truncate toward
  // zero, wrap mod 2³², NaN/±Inf → 0), so it is both exact and simpler than a finite-guarded trunc.
  const r = clampInt(radius | 0, 1, 20);
  const r2 = r * r;
  const offsets: Array<readonly [number, number]> = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push([dx, dy]);
    }
  }
  return { offsets, r };
}

/** The highlight-bloom exponent `g = 1 + clamp(brightness,0,1)·4`, computed in f32 exactly like the
 *  engine (then used as f64). `g ∈ [1, 5]`. Exposed for testing. */
export function lensBlurExponent(brightness: number): number {
  return fr(1 + fr(clamp01(fr(brightness)) * 4));
}

/** Apply Lens Blur to a single-channel (grey, opaque) 2-D image (u16 values 0..65535).
 *  `radius` is clamped to [1,20], `brightness` to [0,1]. Does not mutate the input. */
export function lensBlur2D(image: readonly (readonly number[])[], radius: number, brightness: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const { offsets } = lensBlurDisc(radius);
  const g = lensBlurExponent(brightness);
  const invG = 1 / g; // f64 reciprocal of the f64-widened f32 exponent
  const n = offsets.length;

  return image.map((row, y) =>
    row.map((_, x) => {
      let acc = 0; // f64 accumulation — NO fround, matching the engine's `acc: f64`
      for (let k = 0; k < n; k++) {
        const [dx, dy] = offsets[k];
        const sx = clampIdx(x + dx, w - 1);
        const sy = clampIdx(y + dy, h - 1);
        acc += Math.pow(image[sy][sx] / 65535, g);
      }
      return toU16(Math.pow(acc / n, invG) * 65535);
    }),
  );
}
