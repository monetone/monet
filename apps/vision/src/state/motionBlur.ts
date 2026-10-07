// ─────────────────────────────────────────────────────────────
// Motion Blur (Filter ▸ Blur ▸ Motion Blur) — streak the image along a direction, as
// if the camera (or subject) moved during the exposure. Unlike the isotropic box /
// Gaussian blurs, this averages samples along a single angled line. Engine-free so it
// unit-tests in node; the directional sibling of `boxBlur` (at 0°/90° it IS a box blur).
//
// MUST match `filters.rs motion_blur`:
//   distance < 1 → no-op.
//   dx = cos(angle°),  dy = sin(angle°)            (f32 trig)
//   steps = round(distance),  half = steps / 2     (i32 division, toward zero)
//   per pixel, average the 2·half+1 samples at  round(x + dx·s), round(y + dy·s)  for
//   s ∈ [−half, half], with edge-clamped coordinates (the engine's `idx`).
//   The engine accumulates premultiplied; for fully-opaque pixels (this 1-channel
//   reference's domain) that reduces to the plain mean over the line samples.
//
// Two faithfulness notes:
//  • Rust's `f32::round` rounds half AWAY FROM ZERO (JS `Math.round` rounds half to +∞),
//    so the rounding uses `roundHalfAway`. This matters because round-half-away is NOT
//    translation-invariant across a sign change of the fractional part — e.g. at y=1,
//    dy·s=−0.5 the engine takes `round(1−0.5)=round(0.5)=1`, not `1+round(−0.5)=0`. So
//    `motionBlur2D` re-rounds `round(x + dx·s)` PER PIXEL exactly like the engine; the
//    `motionOffsets` helper exposes only the *nominal* origin offsets `round(dx·s)`
//    (handy for the axis-aligned streak, where they coincide).
//  • The trig is reproduced in f32 (`Math.fround`), but JS `Math.cos`/`Math.sin` are f64,
//    so `fround` of them is *approximately* — not always bit-equal to — Rust's f32 cos/sin
//    for arbitrary angles. The sampled positions agree exactly at the axis-aligned angles
//    (only 0° has dx/dy exactly 1/0; at 90/180/270 the tiny f32 trig residual rounds away)
//    and agree in practice elsewhere.
//
// Continuous mean output (like `boxBlur`); an 8-bit render rounds via `byte()`, matching
// the engine's u16 path to ≤1 LSB. Mirrors the `boxBlur.ts` house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** `angle.to_radians()` constant in f32: `PI / 180` evaluated as f32. */
const DEG2RAD = Math.fround(Math.fround(Math.PI) / 180);

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** Round half away from zero — Rust's `f32::round` (JS `Math.round` rounds half to +∞,
 *  which differs for negative half-integers like −2.5). */
export function roundHalfAway(x: number): number {
  const r = x < 0 ? -Math.round(-x) : Math.round(x);
  return r === 0 ? 0 : r; // normalise −0 (from `0 · negative`) to +0
}

/** The streak geometry for a distance: `steps = round(distance)`, `half = steps/2`
 *  (toward zero), `samples = 2·half + 1`. `distance < 1` (and NaN) → all zero (no-op). */
export function motionSteps(distance: number): { steps: number; half: number; samples: number } {
  const d = fr(distance); // the engine receives an f32 distance and rounds it in f32
  if (!(d >= 1)) return { steps: 0, half: 0, samples: 0 };
  const steps = roundHalfAway(d);
  const half = Math.trunc(steps / 2);
  return { steps, half, samples: 2 * half + 1 };
}

/** The *nominal* integer `[ox, oy]` streak offsets at the origin for `s ∈ [−half, half]`:
 *  `[round(dx·s), round(dy·s)]` with `dx = cos`, `dy = sin` of the angle (f32). These
 *  describe the streak direction and coincide with the engine's per-pixel sampling on
 *  the axis-aligned angles; for oblique angles the actual sampling re-rounds
 *  `round(x + dx·s)` per pixel (see `motionBlur2D`). `distance < 1` → no samples (`[]`). */
export function motionOffsets(angle: number, distance: number): [number, number][] {
  const { half, samples } = motionSteps(distance);
  if (samples === 0) return [];
  const rad = fr(fr(angle) * DEG2RAD);
  const dx = fr(Math.cos(rad));
  const dy = fr(Math.sin(rad));
  const offsets: [number, number][] = [];
  for (let s = -half; s <= half; s++) {
    offsets.push([roundHalfAway(fr(dx * s)), roundHalfAway(fr(dy * s))]);
  }
  return offsets;
}

/** Apply Motion Blur to a single-channel 2-D image: average each pixel's `2·half+1`
 *  streak samples (edge-clamped). The sample positions are re-rounded PER PIXEL as
 *  `round(x + dx·s)`, `round(y + dy·s)` — exactly as the engine does (round-half-away is
 *  not translation-invariant, so precomputed offsets would diverge at oblique angles).
 *  `distance < 1` returns an unchanged copy. Run per channel to blur an opaque RGB
 *  image, exactly as the engine does. */
export function motionBlur2D(
  image: readonly (readonly number[])[],
  angle: number,
  distance: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (!(fr(distance) >= 1) || w === 0) return image.map((row) => [...row]);
  const { half } = motionSteps(distance);
  const rad = fr(fr(angle) * DEG2RAD);
  const dx = fr(Math.cos(rad));
  const dy = fr(Math.sin(rad));
  const cnt = 2 * half + 1;
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let s = -half; s <= half; s++) {
        const sx = roundHalfAway(fr(x + fr(dx * s)));
        const sy = roundHalfAway(fr(y + fr(dy * s)));
        sum += image[clampIdx(sy, h - 1)][clampIdx(sx, w - 1)];
      }
      row[x] = sum / cnt;
    }
    out.push(row);
  }
  return out;
}

/** Pack the smart-filter (id 7) params: `[angle, distance]`. */
export function packMotionBlurParams(angle: number, distance: number): number[] {
  return [angle, distance];
}

/** Read smart-filter params back into `{ angle, distance }` (missing → 0). */
export function unpackMotionBlurParams(params: ArrayLike<number>): { angle: number; distance: number } {
  const at = (i: number): number => (i < params.length ? params[i] : 0);
  return { angle: at(0), distance: at(1) };
}
