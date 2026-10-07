// ─────────────────────────────────────────────────────────────
// Non-separable layer Blend Modes — Hue, Saturation, Color, Luminosity, Darker
// Color, Lighter Color. Unlike the separable modes (`blendModes.ts`), these blend
// the WHOLE pixel: they mix the hue/saturation/luminosity of backdrop and source.
//
// Engine-free so it unit-tests in node. MUST match `color.rs` (`lum`/`set_lum`/
// `set_sat`/`clip_color`/`nonsep_*`) and `blend.rs blend_rgb` exactly. Note the
// luminosity weights are the **W3C** `0.3/0.59/0.11` (NOT the Rec.601 weights the
// adjustments use), and Darker/Lighter Color select a whole pixel by the channel
// **sum** (computed in single precision to match the engine's f32 pick at ties).
// Mirrors the `blendModes.ts` house style.
// ─────────────────────────────────────────────────────────────

import type { Rgb } from "./blendModes";

export type NonSeparableBlendKey = "hue" | "saturation" | "color" | "luminosity" | "darkerColor" | "lighterColor";

export interface NonSeparableBlendInfo {
  /** Engine `BlendMode::to_u8` value. */
  value: number;
  key: NonSeparableBlendKey;
  label: string;
}

// In engine u8 order (PassThrough is 25, hence the gap before Darker/Lighter Color).
export const NON_SEPARABLE_BLEND_MODES: readonly NonSeparableBlendInfo[] = [
  { value: 21, key: "hue", label: "Hue" },
  { value: 22, key: "saturation", label: "Saturation" },
  { value: 23, key: "color", label: "Color" },
  { value: 24, key: "luminosity", label: "Luminosity" },
  { value: 26, key: "darkerColor", label: "Darker Color" },
  { value: 27, key: "lighterColor", label: "Lighter Color" },
];

// W3C blend luminosity weights — distinct from the Rec.601 weights used elsewhere.
export const LUM_R = 0.3;
export const LUM_G = 0.59;
export const LUM_B = 0.11;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
const byte = (n: number): number => Math.round(clamp01(n) * 255);

// Darker/Lighter Color select a whole pixel by a hard sum compare, so — like the
// continuous modes' rounding can't absorb drift here — the sum is computed in
// single precision (`Math.fround`, left-to-right) to match the engine's f32 pick at
// integer-sum ties, where an f64 sum would otherwise choose the other pixel.
const f32 = Math.fround;
const channelSum = (c: C3): number => f32(f32(f32(c[0]) + f32(c[1])) + f32(c[2]));

export type C3 = [number, number, number];

/** W3C luminosity of a colour (channels 0..1). */
export function lum(c: C3): number {
  return LUM_R * c[0] + LUM_G * c[1] + LUM_B * c[2];
}

/** Saturation = max − min channel. */
export function sat(c: C3): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

/** Clip a colour back into [0,1] while preserving its luminosity — exact mirror of
 *  `color.rs clip_color` (the high-clip runs on the already low-clipped values). */
export function clipColor(c: C3): C3 {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: C3 = [c[0], c[1], c[2]];
  if (n < 0) {
    const d = l - n;
    if (Math.abs(d) > 1e-6) out = [l + ((out[0] - l) * l) / d, l + ((out[1] - l) * l) / d, l + ((out[2] - l) * l) / d];
  }
  if (x > 1) {
    const d = x - l;
    if (Math.abs(d) > 1e-6) out = [l + ((out[0] - l) * (1 - l)) / d, l + ((out[1] - l) * (1 - l)) / d, l + ((out[2] - l) * (1 - l)) / d];
  }
  return out;
}

/** Set a colour's luminosity to `l`, preserving hue/saturation — mirror of `set_lum`. */
export function setLum(c: C3, l: number): C3 {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

/** Set a colour's saturation to `s`, preserving the channel ordering — mirror of
 *  `set_sat`. The mid channel is rescaled into [0, s]; min → 0, max → s. */
export function setSat(c: C3, s: number): C3 {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]); // stable ascending by value
  const [imin, imid, imax] = idx;
  const out: C3 = [0, 0, 0];
  if (c[imax] > c[imin]) {
    out[imid] = ((c[imid] - c[imin]) / (c[imax] - c[imin])) * s;
    out[imax] = s;
  }
  out[imin] = 0;
  return out;
}

export function nonsepHue(cb: C3, cs: C3): C3 {
  return setLum(setSat(cs, sat(cb)), lum(cb));
}
export function nonsepSaturation(cb: C3, cs: C3): C3 {
  return setLum(setSat(cb, sat(cs)), lum(cb));
}
export function nonsepColor(cb: C3, cs: C3): C3 {
  return setLum(cs, lum(cb));
}
export function nonsepLuminosity(cb: C3, cs: C3): C3 {
  return setLum(cb, lum(cs));
}

/** Blend a backdrop colour `cb` with a source colour `cs` (both channels 0..1)
 *  under a non-separable `mode`. Exact mirror of `blend.rs blend_rgb`'s
 *  non-separable branch. */
export function blendNonSeparable(mode: NonSeparableBlendKey, cb: C3, cs: C3): C3 {
  switch (mode) {
    case "hue":
      return nonsepHue(cb, cs);
    case "saturation":
      return nonsepSaturation(cb, cs);
    case "color":
      return nonsepColor(cb, cs);
    case "luminosity":
      return nonsepLuminosity(cb, cs);
    case "darkerColor":
      return channelSum(cb) <= channelSum(cs) ? cb : cs;
    case "lighterColor":
      return channelSum(cb) >= channelSum(cs) ? cb : cs;
    default:
      return cs;
  }
}

/** Blend an 8-bit source pixel over an 8-bit backdrop pixel under a non-separable
 *  mode (straight color; opacity/alpha applied separately by the compositor). */
export function blendNonSeparablePixel(mode: NonSeparableBlendKey, backdrop: Rgb, source: Rgb): Rgb {
  const cb: C3 = [backdrop.r / 255, backdrop.g / 255, backdrop.b / 255];
  const cs: C3 = [source.r / 255, source.g / 255, source.b / 255];
  const [r, g, b] = blendNonSeparable(mode, cb, cs);
  return { r: byte(r), g: byte(g), b: byte(b) };
}
