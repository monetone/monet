// ─────────────────────────────────────────────────────────────
// Color Lookup (Image ▸ Adjustments ▸ Color Lookup / adjustment-layer kind 16) — a
// roster of built-in creative "looks", each a deterministic per-pixel RGB grade. These
// are Monet Vision's own looks (not Adobe's proprietary 3D LUTs) but cover the same
// creative ground. Engine-free so it unit-tests in node.
//
// MUST match `pixel_adjust.rs color_lookup_pixel` exactly. Three shared primitives,
// then a per-preset grade, clamped to [0,1]:
//   contrast(x, k) = (x − 0.5)·k + 0.5     (expand/compress around mid-grey)
//   luma           = 0.299r + 0.587g + 0.114b
//   sat(c, amt)    = luma + (c − luma)·amt (amt<1 desaturates, >1 boosts)
// Preset 0 (and any unknown id) is the identity. The adjustment-layer form (kind 16)
// reads the preset from `params[0] as u8`; empty params are the identity.
//
// Runs in f64; the engine pipeline is f32. The grades are continuous (clamped only at
// write-out), so f64↔f32 differences are absorbed by the round-half-up `byte()`
// quantization (≤1 LSB). Mirrors the `selectiveColor.ts` / `gradientMap.ts` house style.
// ─────────────────────────────────────────────────────────────

/** Built-in look names; the array index is the engine preset id (0 = identity). */
export const COLOR_LOOKUP_PRESETS = [
  "None",
  "Crisp Warm",
  "Crisp Winter",
  "Bleach Bypass",
  "Candlelight",
  "Drop Blues",
  "Fall Colors",
  "Moonlight",
  "Soft Warming",
] as const;

/** The identity preset (no grade). */
export const IDENTITY_PRESET = 0;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit (Photoshop's `to8`). The engine stores at u16 (`to16`) and its
// display readback truncates (`>>8`), so this reference can differ by ≤1 LSB.
const byte = (n: number): number => Math.round(clamp01(n) * 255);

/** Expand/compress a channel around mid-grey: `(x − 0.5)·k + 0.5`. k>1 adds contrast. */
export function contrast(x: number, k: number): number {
  return (x - 0.5) * k + 0.5;
}

/** Rec.601 luminance of normalised 0..1 channels (the engine's weighting). */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Move a channel toward (`amt`<1) or away from (`amt`>1) the pixel's luminance:
 *  `luma + (c − luma)·amt`. amt=0 fully desaturates, amt=1 is identity. */
export function sat(c: number, lumaValue: number, amt: number): number {
  return lumaValue + (c - lumaValue) * amt;
}

/** Normalise a preset id to the engine's `as u8` semantics: truncate toward zero and
 *  saturate into `[0, 255]` (Rust float→int casts saturate, not wrap). */
function presetId(preset: number): number {
  const t = Math.trunc(preset);
  if (!Number.isFinite(t)) return 0; // NaN → 0 (Rust `NaN as u8` is 0); ±Inf handled below
  return t < 0 ? 0 : t > 255 ? 255 : t;
}

/** Apply a Color Lookup preset to a normalised 0..1 pixel, returning the clamped grade.
 *  Preset 0 and any unknown id are the identity. Exact mirror of `color_lookup_pixel`. */
export function colorLookupPixel(
  preset: number,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const l = luma(r, g, b);
  const c = (x: number, k: number): number => contrast(x, k);
  const s = (x: number, amt: number): number => sat(x, l, amt);
  let or: number;
  let og: number;
  let ob: number;
  switch (presetId(preset)) {
    case 1: // Crisp Warm
      or = c(r, 1.12) * 1.06 + 0.02;
      og = c(g, 1.12);
      ob = c(b, 1.12) * 0.92;
      break;
    case 2: // Crisp Winter
      or = c(r, 1.12) * 0.92;
      og = c(g, 1.12);
      ob = c(b, 1.12) * 1.08 + 0.02;
      break;
    case 3: // Bleach Bypass
      or = c(s(r, 0.35), 1.4);
      og = c(s(g, 0.35), 1.4);
      ob = c(s(b, 0.35), 1.4);
      break;
    case 4: // Candlelight
      or = r * 1.1 + 0.04;
      og = g * 0.98 + 0.02;
      ob = b * 0.78;
      break;
    case 5: // Drop Blues
      or = r * 0.95;
      og = g * 1.02;
      ob = b * 0.62 + 0.05;
      break;
    case 6: // Fall Colors
      or = s(r, 1.2) * 1.04 + 0.02;
      og = s(g, 1.2) * 0.98;
      ob = s(b, 1.2) * 0.9;
      break;
    case 7: {
      // Moonlight — cool, near-monochrome blue
      const d = l * 0.8;
      or = d * 0.8 + 0.02;
      og = d * 0.95 + 0.03;
      ob = d * 1.2 + 0.08;
      break;
    }
    case 8: // Soft Warming
      or = c(r, 0.92) * 1.04 + 0.03;
      og = c(g, 0.92) + 0.02;
      ob = c(b, 0.92) * 0.96 + 0.02;
      break;
    default: // 0 / unknown → identity
      or = r;
      og = g;
      ob = b;
      break;
  }
  return [clamp01(or), clamp01(og), clamp01(ob)];
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply a Color Lookup preset to an 8-bit pixel the way the engine does (grade in
 *  0..1, clamp, quantize). Runs in f64; matches the engine to 8-bit precision. */
export function applyColorLookup(preset: number, r: number, g: number, b: number): Rgb {
  const [or, og, ob] = colorLookupPixel(preset, r / 255, g / 255, b / 255);
  return { r: byte(or), g: byte(og), b: byte(ob) };
}

/** First slot of a kind-16 params array that carries a loaded 3D LUT instead
 *  of a preset id. Mirrors apps/vision/src/state/colorLookupLut.ts. */
const COLOR_LUT_MARKER = -1;

/** Pack the adjustment-layer (kind 16) params: `Float32Array([preset])`. */
export function packColorLookup(preset: number): Float32Array {
  return new Float32Array([preset]);
}

/** Read the preset from kind-16 params; empty params are the identity (preset 0),
 *  matching the engine's `if p.is_empty() { return identity }`. Params whose
 *  first slot is the loaded-LUT marker (-1, see vision's colorLookupLut.ts)
 *  carry a 3D LUT, not a preset id, and read as the identity rather than
 *  saturating that -1 into preset 0. */
export function unpackColorLookupPreset(params: ArrayLike<number>): number {
  if (params.length === 0 || params[0] === COLOR_LUT_MARKER) return IDENTITY_PRESET;
  return presetId(params[0]);
}
