// ─────────────────────────────────────────────────────────────
// Arbitrary Rotation (Image ▸ Image Rotation ▸ Arbitrary) — rotates the whole canvas by an
// arbitrary angle (degrees, clockwise), growing the canvas to fit the turned content and
// filling the new corners with 0 (transparent/black). Exact multiples of 90° take the
// lossless permutation paths. Per-channel and deterministic; engine-free so it unit-tests in
// node (each `number` is one channel of a pixel).
//
// MUST match `mod.rs rotate_arbitrary` + `rotate_buf`:
//   a = angle mod 360.  a≈0/360 → no-op; a≈90 → rotate90 CW; a≈180 → rotate180; a≈270 → CCW.
//   else (arbitrary):  rad = angle·π/180,  (sn, cs) = (sin, cos)
//     nw = ceil(W·|cs| + H·|sn|) (≥1),  nh = ceil(W·|sn| + H·|cs|) (≥1)   (rotated bbox)
//     inverse map dest→source (un-rotate by −θ about the centre):
//       dx = nx+0.5 − nw/2,  dy = ny+0.5 − nh/2
//       sx = dx·cs + dy·sn + W/2 − 0.5,   sy = −dx·sn + dy·cs + H/2 − 0.5
//     ZERO-PAD bilinear at (sx, sy): if floor is fully outside (x0<−1 || y0<−1 || x0>W || y0>H)
//       → 0; else blend the 4 taps but count ONLY in-bounds taps (out-of-bounds contribute 0,
//       NOT edge-clamped), accumulating `src·wx·wy` in that order; round half-up + clamp.
//
// Unlike the Distort family's edge-clamped `sampleBilinear`, this fades to 0 at the rotated
// edges (the engine's `rotate_buf` zero-pads), so it has its own sampler. f32 throughout
// (`Math.fround`) in the engine's order; reuses `roundHalfAway`; mirrors the `twirl.ts` style.
//
// FIDELITY CAVEAT — the geometry, the canvas sizing, and the zero-pad bilinear are bit-exact,
// EXCEPT the rotation's sin/cos. JS `Math.sin`/`Math.cos` are f64 (then `fround`ed, ≈ a
// correctly-rounded f32), whereas the engine's `rad.sin_cos()` lowers to the platform's native
// f32 `sinf`/`cosf` (only ~1 ULP accurate). They disagree by 1 f32 ULP for ~0.03% of angles,
// which can shift a pixel by ≤1 LSB and — at a `ceil` knife-edge — very occasionally flip
// `nw`/`nh` by one. So this is bit-exact only at trig-AGREEING angles: the 90/180/270 paths use
// no trig, and the 30°/200° goldens were verified to agree. This module is the engine-MIRROR
// reference used by tests; production rotation runs in the Rust engine, so the divergence has
// no end-user effect — but DON'T add a strict golden at an arbitrary angle without first
// confirming the engine and JS trig agree there.
// ─────────────────────────────────────────────────────────────

import { roundHalfAway } from "./motionBlur";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const ROTATE_MAX = 65535;
/** `f32::to_radians` factor: `(PI / 180)` evaluated as f32. */
const DEG2RAD = Math.fround(Math.fround(Math.PI) / 180);

const clampU16 = (v: number): number => (v < 0 ? 0 : v > ROTATE_MAX ? ROTATE_MAX : v);

/** Zero-pad bilinear sample matching `rotate_buf`: out-of-bounds taps contribute 0 (not
 *  edge-clamped), the fully-outside floor returns the fill (0), and each tap accumulates
 *  `src·wx·wy` in the engine's order. Exposed for testing the sampler in isolation. */
export function sampleZeroPad(
  image: readonly (readonly number[])[],
  fx: number,
  fy: number,
  w: number,
  h: number,
): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < -1 || y0 < -1 || x0 > w || y0 > h) return 0; // fully outside → fill
  const tx = fr(fx - x0);
  const ty = fr(fy - y0);
  let acc = 0;
  for (const [oy, wy] of [
    [0, fr(1 - ty)],
    [1, ty],
  ] as const) {
    for (const [ox, wx] of [
      [0, fr(1 - tx)],
      [1, tx],
    ] as const) {
      const sx = x0 + ox;
      const sy = y0 + oy;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        acc = fr(acc + fr(fr(image[sy][sx] * wx) * wy)); // src·wx·wy, in-bounds taps only
      }
    }
  }
  return clampU16(roundHalfAway(acc));
}

/** Lossless 90° rotation (cw = clockwise), swapping the dimensions — mirrors `rotate_90`. */
function rotate90(image: readonly (readonly number[])[], cw: boolean): number[][] {
  const oh = image.length;
  const ow = image[0].length;
  const nh = ow; // new height = old width
  const nw = oh; // new width = old height
  const out = Array.from({ length: nh }, () => new Array<number>(nw).fill(0));
  for (let ny = 0; ny < nh; ny++) {
    for (let nx = 0; nx < nw; nx++) {
      // engine map: cw → (ny, oh−1−nx); ccw → (ow−1−ny, nx)
      const sx = cw ? ny : ow - 1 - ny;
      const sy = cw ? oh - 1 - nx : nx;
      out[ny][nx] = image[sy][sx];
    }
  }
  return out;
}

/** Lossless 180° rotation (dimensions unchanged) — mirrors `rotate_180`. */
function rotate180(image: readonly (readonly number[])[]): number[][] {
  const oh = image.length;
  const ow = image[0].length;
  const out = Array.from({ length: oh }, () => new Array<number>(ow).fill(0));
  for (let ny = 0; ny < oh; ny++) {
    for (let nx = 0; nx < ow; nx++) out[ny][nx] = image[oh - 1 - ny][ow - 1 - nx];
  }
  return out;
}

/** Rotate a single-channel 2-D image (u16 values 0..65535) by `angleDeg` clockwise, growing
 *  the canvas to fit and zero-filling the new corners. Run per channel for an RGB(A) image. */
export function rotateArbitrary2D(
  image: readonly (readonly number[])[],
  angleDeg: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const a = ((angleDeg % 360) + 360) % 360; // rem_euclid(360)
  if (a < 1e-4 || 360 - a < 1e-4) return image.map((row) => [...row]); // no-op
  if (Math.abs(a - 90) < 1e-4) return rotate90(image, true);
  if (Math.abs(a - 180) < 1e-4) return rotate180(image);
  if (Math.abs(a - 270) < 1e-4) return rotate90(image, false);

  const ow = w;
  const oh = h;
  const rad = fr(fr(angleDeg) * DEG2RAD);
  const sn = fr(Math.sin(rad));
  const cs = fr(Math.cos(rad));
  const absCs = Math.abs(cs);
  const absSn = Math.abs(sn);
  const nw = Math.max(Math.ceil(fr(fr(ow * absCs) + fr(oh * absSn))), 1);
  const nh = Math.max(Math.ceil(fr(fr(ow * absSn) + fr(oh * absCs))), 1);
  const ocx = fr(ow / 2);
  const ocy = fr(oh / 2);
  const ncx = fr(nw / 2);
  const ncy = fr(nh / 2);
  const out = Array.from({ length: nh }, () => new Array<number>(nw).fill(0));
  for (let ny = 0; ny < nh; ny++) {
    for (let nx = 0; nx < nw; nx++) {
      const dx = fr(fr(nx + 0.5) - ncx);
      const dy = fr(fr(ny + 0.5) - ncy);
      const sx = fr(fr(fr(fr(dx * cs) + fr(dy * sn)) + ocx) - 0.5);
      const sy = fr(fr(fr(fr(fr(-dx) * sn) + fr(dy * cs)) + ocy) - 0.5);
      out[ny][nx] = sampleZeroPad(image, sx, sy, ow, oh);
    }
  }
  return out;
}
