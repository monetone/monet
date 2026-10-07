// ─────────────────────────────────────────────────────────────
// Radial Blur (Filter ▸ Blur ▸ Radial Blur) — smear the image along circular arcs
// (Spin) or along rays from the centre (Zoom), as if the camera rotated or punched
// forward during the exposure. Each pixel averages `steps` samples taken along its own
// arc/ray; engine-free so it unit-tests in node, reusing Twirl's `sampleBilinear` and
// Motion Blur's `roundHalfAway`.
//
// MUST match `mod.rs radial_blur_buf`:
//   cx = w·ccx, cy = h·ccy       (the Blur Center as canvas fractions; 0.5/0.5 = centre)
//   steps = 8 (quality 0 Draft) / 32 (quality 2 Best) / 16 (anything else, Good)
//   a = amount/100, maxAng = a·0.8, maxScl = a·1.2
//   per pixel, dx = x+0.5−cx, dy = y+0.5−cy, r = √(dx²+dy²), θ = atan2(dy, dx):
//     for k in 0..steps:  t = k/(steps−1) − 0.5  (−0.5 … +0.5, symmetric about the pixel)
//       Spin (zoom=false): ang = θ + t·maxAng;  src = (cx + r·cos(ang), cy + r·sin(ang))
//       Zoom (zoom=true) : s = 1 + t·maxScl;     src = (cx + dx·s,        cy + dy·s)
//       cxf = clamp(src.x − 0.5, 0, w−1),  cyf = clamp(src.y − 0.5, 0, h−1)   ← edge-replicate
//       acc += sample_bi(cxf, cyf)
//     out = round(acc / steps)
//
// The source coordinate is CLAMPED into the image before sampling, so off-edge samples
// replicate the border (Photoshop) rather than going to 0 — the opposite of the Distort
// family (twirl/zigzag), where an off-image source samples black. A consequence: a
// constant image is invariant at any amount (every clamped sample returns the constant).
//
// At `amount = 0` (maxAng = maxScl = 0) every sample collapses onto the pixel itself:
// Zoom is the EXACT identity (s ≡ 1 → src = (x+0.5, y+0.5) → samples pixel (x,y) with no
// trig), while Spin is the identity only approximately — it routes through cos/sin, so the
// f32 round-trip can nudge the sample a sub-LSB off the integer grid; a constant image is
// still exact, a textured one differs by ≤ a few LSB (and the engine diverges identically).
//
// The geometry is f32 (`Math.fround`); the bilinear taps are integers, so the
// accumulator is an exact integer sum (≤ 32·65535 < 2²⁴) and `acc/steps` rounds half-away
// (Rust `f32::round`; `acc ≥ 0` so this equals half-up). Mirrors the `twirl.ts` /
// `motionBlur.ts` house style.
// ─────────────────────────────────────────────────────────────

import { sampleBilinear } from "./twirl";
import { roundHalfAway } from "./motionBlur";

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const RADIAL_MAX = 65535;
/** Photoshop's Draft / Good / Best quality → the engine's sample count (#149). */
export function radialSteps(quality: number): number {
  return quality === 0 ? 8 : quality === 2 ? 32 : 16;
}
/** The default (Good) sample count, and the Blur Center at the image centre. */
export const RADIAL_DEFAULT_QUALITY = 1;
export const RADIAL_DEFAULT_CENTER = 0.5;
/** Spin sweep gain: ±radians at amount 100 is `1.0·0.8` (engine `max_ang = a·0.8`).
 *  `fround`ed so `fr(a·SPIN_GAIN)` is a single f32 multiply matching Rust's f32 literal. */
const SPIN_GAIN = Math.fround(0.8);
/** Zoom scale gain: ±fraction at amount 100 is `1.0·1.2` (engine `max_scl = a·1.2`).
 *  `fround`ed so the trig-free Zoom path is bit-exact to Rust's f32 `a * 1.2`. */
const ZOOM_GAIN = Math.fround(1.2);

/** Clamp to `[0, hi]` — the engine's edge-replicate border (`.clamp(0.0, (w−1) as f32)`). */
const clampTo = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The `radialSteps(quality)` source coordinates `(fx, fy)` destination pixel `(x, y)`
 *  averages, along its Spin arc (`zoom=false`) or Zoom ray (`zoom=true`) for `amount`.
 *  `ccx`/`ccy` are the Blur Center as canvas fractions and `quality` picks the sample
 *  count — both are engine parameters the dialog exposes (#149). Each coordinate is
 *  already clamped into the image (edge-replicate), so every one is a valid
 *  `sampleBilinear` input. Exposed so the geometry is unit-testable independently of
 *  the averaging. */
export function radialSamples(
  x: number,
  y: number,
  w: number,
  h: number,
  amount: number,
  zoom: boolean,
  ccx = RADIAL_DEFAULT_CENTER,
  ccy = RADIAL_DEFAULT_CENTER,
  quality = RADIAL_DEFAULT_QUALITY,
): { fx: number; fy: number }[] {
  const cx = fr(w * fr(ccx));
  const cy = fr(h * fr(ccy));
  const STEPS = radialSteps(quality);
  const a = fr(fr(Math.trunc(amount)) / 100); // engine takes a u32 amount
  const maxAng = fr(a * SPIN_GAIN);
  const maxScl = fr(a * ZOOM_GAIN);
  const dx = fr(fr(x + 0.5) - cx);
  const dy = fr(fr(y + 0.5) - cy);
  const r = fr(Math.sqrt(fr(fr(dx * dx) + fr(dy * dy))));
  const theta = fr(Math.atan2(dy, dx));
  const hiX = w - 1;
  const hiY = h - 1;
  const out: { fx: number; fy: number }[] = [];
  for (let k = 0; k < STEPS; k++) {
    const t = fr(fr(k / (STEPS - 1)) - 0.5);
    let sx: number;
    let sy: number;
    if (zoom) {
      const s = fr(1 + fr(t * maxScl));
      sx = fr(cx + fr(dx * s));
      sy = fr(cy + fr(dy * s));
    } else {
      const ang = fr(theta + fr(t * maxAng));
      sx = fr(cx + fr(r * fr(Math.cos(ang))));
      sy = fr(cy + fr(r * fr(Math.sin(ang))));
    }
    out.push({ fx: clampTo(fr(sx - 0.5), hiX), fy: clampTo(fr(sy - 0.5), hiY) });
  }
  return out;
}

/** Apply Radial Blur to a single-channel 2-D image (u16 values 0..65535): average each
 *  pixel's `radialSamples` reconstructed with `sampleBilinear`, then round half-away.
 *  Run per channel to blur an opaque RGB image, exactly as the engine does (samples are
 *  edge-clamped, so a constant image is unchanged). */
export function radialBlur2D(
  image: readonly (readonly number[])[],
  amount: number,
  zoom: boolean,
  ccx = RADIAL_DEFAULT_CENTER,
  ccy = RADIAL_DEFAULT_CENTER,
  quality = RADIAL_DEFAULT_QUALITY,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  const steps = radialSteps(quality);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const samples = radialSamples(x, y, w, h, amount, zoom, ccx, ccy, quality);
      let acc = 0;
      for (const { fx, fy } of samples) acc = fr(acc + sampleBilinear(image, fx, fy));
      out[y][x] = roundHalfAway(fr(acc / steps));
    }
  }
  return out;
}
