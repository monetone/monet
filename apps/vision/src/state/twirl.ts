// ─────────────────────────────────────────────────────────────
// Twirl (Filter ▸ Distort ▸ Twirl) — spin the image around its centre, the twist growing
// stronger toward the middle and fading to nothing at the edge. Unlike the kernel filters,
// this is a *geometric warp*: each destination pixel inverse-maps to a fractional source
// position and is reconstructed by bilinear interpolation. Engine-free so it unit-tests in
// node; the `sampleBilinear` sampler is the reusable core for the whole Distort family.
//
// MUST match `mod.rs twirl_buf` + `sample_bi`:
//   cx = w/2,  cy = h/2,  r = max(min(cx, cy), 1)
//   per pixel:  dx = x + 0.5 − cx,  dy = y + 0.5 − cy
//   t   = max(1 − √(dx²+dy²)/r, 0)            (1 at the centre, 0 at radius r and beyond)
//   ang = maxang · t²                          (maxang = angle°·π/180; twist ∝ t²)
//   source = (cx + dx·cos − dy·sin − 0.5,  cy + dx·sin + dy·cos − 0.5)   (rotate by ang)
//   out = sample_bi(src, source)               (bilinear, edge-clamped, round-to-nearest)
// Outside the radius t = 0 → ang = 0 → the source is exactly (x, y) → identity; `angle 0`
// is the exact identity everywhere. A rotation preserves distance from the centre, so the
// source always sits at the same radius as the destination.
//
// All geometry is in f32 (`Math.fround`); JS `Math.sin/cos/sqrt` are f64 so `fround` of
// them is *approximately* the engine's f32. Because the output is a bilinear blend rounded
// to nearest (NOT a nearest-neighbour pick), a ≤1 ULP coordinate difference only shifts the
// result by ≤1 LSB — the `floor` cell choice is absorbed by the zero weight at integer
// boundaries. Mirrors the `boxBlur.ts` / `vignette.ts` house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** `to_radians()` constant in f32: `PI / 180` evaluated as f32. */
const DEG2RAD = Math.fround(Math.fround(Math.PI) / 180);
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const TWIRL_MAX = 65535;

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clampU16 = (n: number): number => (n < 0 ? 0 : n > TWIRL_MAX ? TWIRL_MAX : n);

/** Bilinear-sample a single-channel image at fractional `(fx, fy)`, mirroring the engine's
 *  `sample_bi`: a position far outside the image (`fx<−1 || fy<−1 || fx>w || fy>h`) returns
 *  0 (the transparent border); otherwise the four edge-clamped taps around `(fx, fy)` are
 *  blended by the fractional position and rounded to the nearest 16-bit value. The blend
 *  is non-negative (u16 samples, non-negative weights), so `Math.round` (half toward +∞)
 *  equals the engine's `f32::round` (half away from zero) here. */
export function sampleBilinear(image: readonly (readonly number[])[], fx: number, fy: number): number {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return 0;
  if (fx < -1 || fy < -1 || fx > w || fy > h) return 0;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
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
      const sx = clampIdx(x0 + ox, w - 1);
      const sy = clampIdx(y0 + oy, h - 1);
      acc = fr(acc + fr(image[sy][sx] * fr(wx * wy)));
    }
  }
  return clampU16(Math.round(acc));
}

/** The source coordinate `(fx, fy)` that destination pixel `(x, y)` samples FROM under a
 *  twirl of `angleDeg` degrees: rotate the centre-offset by `maxang·t²`. */
export function twirlSource(
  x: number,
  y: number,
  w: number,
  h: number,
  angleDeg: number,
): { fx: number; fy: number } {
  const cx = fr(w / 2);
  const cy = fr(h / 2);
  const r = Math.max(Math.min(cx, cy), 1);
  const maxang = fr(fr(angleDeg) * DEG2RAD);
  const dx = fr(fr(x + 0.5) - cx);
  const dy = fr(fr(y + 0.5) - cy);
  const dist = fr(Math.sqrt(fr(fr(dx * dx) + fr(dy * dy))));
  const t = Math.max(fr(1 - fr(dist / r)), 0);
  const ang = fr(fr(maxang * t) * t);
  const s = fr(Math.sin(ang));
  const c = fr(Math.cos(ang));
  const fx = fr(fr(fr(cx + fr(dx * c)) - fr(dy * s)) - 0.5);
  const fy = fr(fr(fr(cy + fr(dx * s)) + fr(dy * c)) - 0.5);
  return { fx, fy };
}

/** Apply Twirl to a single-channel 2-D image (u16 values 0..65535): inverse-map each pixel
 *  through `twirlSource` and reconstruct it with `sampleBilinear`. `angle 0` (and any pixel
 *  outside the radius) is the exact identity. Run per channel to twirl an opaque RGB image,
 *  exactly as the engine does. */
export function twirl2D(image: readonly (readonly number[])[], angleDeg: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      const { fx, fy } = twirlSource(x, y, w, h, angleDeg);
      row[x] = sampleBilinear(image, fx, fy);
    }
    out.push(row);
  }
  return out;
}

/** Pack the smart-filter (id 14) params: `[angle]`. */
export function packTwirlParams(angle: number): number[] {
  return [angle];
}

/** Read the angle from smart-filter params (missing → 0), f32-rounded to mirror the
 *  engine's f32 parameter so a replay reproduces the same warp. */
export function unpackTwirlParams(params: ArrayLike<number>): number {
  return params.length === 0 ? 0 : fr(params[0]);
}
