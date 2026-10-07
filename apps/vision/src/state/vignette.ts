// ─────────────────────────────────────────────────────────────
// Vignette (Filter ▸ Vignette) — darken the image radially toward the corners, the
// classic "lens falloff" look. Unlike the neighbour-based blurs, each pixel is scaled
// by a factor that depends only on its distance from the image centre. Engine-free so
// it unit-tests in node.
//
// MUST match `filters.rs vignette`:
//   cx = w/2,  cy = h/2,  maxd = max(√(cx² + cy²), 1)   (half-diagonal, the corner radius)
//   per pixel:  dx = (x − cx)/maxd,  dy = (y − cy)/maxd,  d = √(dx² + dy²)   (0 at centre,
//   ≈1 at the corners),  f = clamp(1 − amount·d²·2, 0, 1)   (1 at centre, fading out),
//   each channel:  (v · f) as u16   — TRUNCATE toward zero (not round-half-up). Vignette
//   only darkens (f ≤ 1), and alpha is untouched.
//
// The factor is reproduced in f32 (`Math.fround`). The geometry uses `sqrt`, and JS
// `Math.sqrt` is f64, so `fround` of it is *approximately* — not always bit-equal to —
// Rust's f32 `sqrt`; combined with the `as u16` truncation this can shift a channel by
// ≤1 LSB at an exact integer boundary (the factor itself is continuous, so there is no
// catastrophic decision — only ≤1 LSB). Amount 0 is the exact identity. The dialog maps
// Amount 0..100% → `amount = pct/100`. Mirrors the `boxBlur.ts` / `addNoise.ts` style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const VIGNETTE_MAX = 65535;

/** The radial darkening factor (0..1) at pixel `(x, y)` of a `w × h` image for `amount`
 *  (0..1): `clamp01(1 − amount · d² · 2)` where `d` is the distance from the centre
 *  normalised by the half-diagonal. 1 at the centre, fading toward the corners. */
export function vignetteFactor(x: number, y: number, w: number, h: number, amount: number): number {
  const cx = fr(w / 2);
  const cy = fr(h / 2);
  const maxd = Math.max(fr(Math.sqrt(fr(fr(cx * cx) + fr(cy * cy)))), 1);
  const dx = fr(fr(x - cx) / maxd);
  const dy = fr(fr(y - cy) / maxd);
  const d = fr(Math.sqrt(fr(fr(dx * dx) + fr(dy * dy))));
  const t = fr(fr(fr(fr(amount) * d) * d) * 2);
  return clamp01(fr(1 - t));
}

/** Darken one 16-bit channel by a vignette factor: `(value · f) as u16` — multiply in
 *  f32 then TRUNCATE toward zero (matching the engine's `as u16`, not round-half-up). */
export function applyVignetteChannel(value: number, f: number): number {
  return Math.trunc(fr(value * f));
}

/** Apply Vignette to a flat 16-bit RGBA buffer (length = w·h·4), returning a fresh
 *  buffer. Each pixel's RGB is scaled by its radial factor; alpha is copied untouched.
 *  Mirrors `filters.rs vignette`. `amount` is a 0..1 fraction. */
export function vignette(
  pixels: ArrayLike<number>,
  w: number,
  h: number,
  amount: number,
): number[] {
  const out = Array.from(pixels, (v) => v);
  const amt = fr(amount);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = vignetteFactor(x, y, w, h, amt);
      const p = (y * w + x) * 4;
      out[p] = applyVignetteChannel(out[p], f);
      out[p + 1] = applyVignetteChannel(out[p + 1], f);
      out[p + 2] = applyVignetteChannel(out[p + 2], f);
      // out[p + 3] (alpha) left untouched
    }
  }
  return out;
}

/** Pack the smart-filter (id 10) params: `[amount]`. */
export function packVignetteParams(amount: number): number[] {
  return [amount];
}

/** Read the amount from smart-filter params (missing → 0), f32-rounded to mirror the
 *  engine's f32 parameter so a replay reproduces the same falloff. */
export function unpackVignetteParams(params: ArrayLike<number>): number {
  return params.length === 0 ? 0 : fr(params[0]);
}
