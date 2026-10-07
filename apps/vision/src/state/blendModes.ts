// ─────────────────────────────────────────────────────────────
// Layer Blend Modes — the separable per-channel blend functions B(cb, cs).
//
// `cb` = backdrop channel, `cs` = source (layer) channel, both 0..1. Engine-free so
// it unit-tests in node; the engine applies these per channel in its compositor.
// MUST match `blend.rs blend_channel` (and `hard_light`/`soft_light`) exactly. The
// six non-separable modes (Hue/Saturation/Color/Luminosity/Darker Color/Lighter
// Color) operate on the whole pixel and live engine-side in `blend_rgb` — not here.
// Mirrors the `*.ts` adjustment-module house style.
// ─────────────────────────────────────────────────────────────

/** Keys for the separable blend modes, paired with the engine's u8 value. */
export type BlendModeKey =
  | "normal" | "dissolve" | "darken" | "multiply" | "colorBurn" | "linearBurn"
  | "lighten" | "screen" | "colorDodge" | "linearDodge" | "overlay" | "softLight"
  | "hardLight" | "vividLight" | "linearLight" | "pinLight" | "hardMix"
  | "difference" | "exclusion" | "subtract" | "divide";

export interface BlendModeInfo {
  /** Engine `BlendMode::to_u8` value. */
  value: number;
  key: BlendModeKey;
  label: string;
}

// In engine u8 order (0..20). The non-separable modes (21..24, 26, 27) and
// PassThrough (25) are intentionally omitted — they are not per-channel.
export const SEPARABLE_BLEND_MODES: readonly BlendModeInfo[] = [
  { value: 0, key: "normal", label: "Normal" },
  { value: 1, key: "dissolve", label: "Dissolve" },
  { value: 2, key: "darken", label: "Darken" },
  { value: 3, key: "multiply", label: "Multiply" },
  { value: 4, key: "colorBurn", label: "Color Burn" },
  { value: 5, key: "linearBurn", label: "Linear Burn" },
  { value: 6, key: "lighten", label: "Lighten" },
  { value: 7, key: "screen", label: "Screen" },
  { value: 8, key: "colorDodge", label: "Color Dodge" },
  { value: 9, key: "linearDodge", label: "Linear Dodge (Add)" },
  { value: 10, key: "overlay", label: "Overlay" },
  { value: 11, key: "softLight", label: "Soft Light" },
  { value: 12, key: "hardLight", label: "Hard Light" },
  { value: 13, key: "vividLight", label: "Vivid Light" },
  { value: 14, key: "linearLight", label: "Linear Light" },
  { value: 15, key: "pinLight", label: "Pin Light" },
  { value: 16, key: "hardMix", label: "Hard Mix" },
  { value: 17, key: "difference", label: "Difference" },
  { value: 18, key: "exclusion", label: "Exclusion" },
  { value: 19, key: "subtract", label: "Subtract" },
  { value: 20, key: "divide", label: "Divide" },
];

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs). Blend
// outputs are continuous and quantize here, so f64-vs-f32 drift is absorbed to ≤1
// LSB (the exception is HardMix's binary threshold — see its case).
const byte = (n: number): number => Math.round(clamp01(n) * 255);
// `min(n, 1)` matching Rust `f32::min` (returns the non-NaN operand, so NaN → 1).
const min1 = (n: number): number => (n < 1 ? n : 1);

/** Hard Light, B(cb, cs) — exact mirror of `blend.rs hard_light`. */
export function hardLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb * (2 * cs);
  const s = 2 * cs - 1;
  return cb + s - cb * s; // screen(cb, 2cs-1)
}

/** Soft Light, B(cb, cs) — exact mirror of `blend.rs soft_light` (Photoshop/W3C). */
export function softLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

// Vivid Light helper (color-burn below 0.5, color-dodge above) — shared by
// VividLight and HardMix, exact mirror of the engine.
function vivid(cb: number, cs: number): number {
  if (cs <= 0.5) {
    const d = 2 * cs;
    return d <= 0 ? 0 : 1 - min1((1 - cb) / d);
  }
  const d = 2 * (cs - 0.5);
  return d >= 1 ? 1 : min1(cb / (1 - d));
}

/** The separable blend of a backdrop channel `cb` with a source channel `cs` (both
 *  0..1) under `mode`. Exact mirror of `blend.rs blend_channel`. */
export function blendChannel(mode: BlendModeKey, cb: number, cs: number): number {
  switch (mode) {
    case "normal":
    case "dissolve":
      return cs;
    case "darken":
      return Math.min(cb, cs);
    case "multiply":
      return cb * cs;
    case "colorBurn":
      return cs <= 0 ? 0 : 1 - min1((1 - cb) / cs);
    case "linearBurn":
      return Math.max(cb + cs - 1, 0);
    case "lighten":
      return Math.max(cb, cs);
    case "screen":
      return cb + cs - cb * cs;
    case "colorDodge":
      return cs >= 1 ? 1 : min1(cb / (1 - cs));
    case "linearDodge":
      return Math.min(cb + cs, 1);
    case "overlay":
      return hardLight(cs, cb);
    case "hardLight":
      return hardLight(cb, cs);
    case "softLight":
      return softLight(cb, cs);
    case "vividLight":
      return vivid(cb, cs);
    case "linearLight":
      return clamp01(cb + 2 * cs - 1);
    case "pinLight":
      return cs > 0.5 ? Math.max(cb, 2 * (cs - 0.5)) : Math.min(cb, 2 * cs);
    case "hardMix":
      // Binary threshold on a continuous value — the only mode with no quantization
      // to absorb f64-vs-f32 drift, so it can differ from the engine by 0↔255 on the
      // knife-edge `cb+cs ≈ 1` diagonal. Acceptable (HardMix is a posterizing mode).
      return vivid(cb, cs) < 0.5 ? 0 : 1;
    case "difference":
      return Math.abs(cb - cs);
    case "exclusion":
      return cb + cs - 2 * cb * cs;
    case "subtract":
      return Math.max(cb - cs, 0);
    case "divide":
      return cs <= 0 ? 1 : min1(cb / cs);
    default:
      return cs;
  }
}

/** The separable blend of two 8-bit channel values → 8-bit. */
export function blendChannel8(mode: BlendModeKey, cb: number, cs: number): number {
  return byte(blendChannel(mode, cb / 255, cs / 255));
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Blend an 8-bit source pixel over an 8-bit backdrop pixel, per channel (straight
 *  color, no opacity/alpha — that is applied separately by the compositor). */
export function blendPixel(mode: BlendModeKey, backdrop: Rgb, source: Rgb): Rgb {
  return {
    r: blendChannel8(mode, backdrop.r, source.r),
    g: blendChannel8(mode, backdrop.g, source.g),
    b: blendChannel8(mode, backdrop.b, source.b),
  };
}
