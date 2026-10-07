// ─────────────────────────────────────────────────────────────
// Photo Filter (Image ▸ Adjustments ▸ Photo Filter) — pure tint math + presets.
//
// Tints the image toward a filter colour by a density, optionally preserving
// luminosity (the warming/cooling-filter look). Engine-free so it unit-tests in
// node; two consumers:
//   • direct adjustment → `adjust_photo_filter(fr,fg,fb,density,preserve_lum)`;
//   • kind-11 adjustment layer → `Float32Array(4)` = `[fr,fg,fb,density]` (no
//     preserve-luminosity on that path).
// The tint formula here MUST match `adjust.rs photo_filter` / `pixel_adjust.rs`
// kind 11: per channel `n = c*(1-d) + c*f*d*2`, clamp[0,1]; then if preserving
// luminosity, scale by `l / max(nl, 1e-4)` and clamp. Colours/density are
// fractions (0..1) at the engine boundary. Mirrors `gradientMap.ts` style.
// ─────────────────────────────────────────────────────────────

/** An 8-bit filter colour (matches Photoshop's colour swatch / preset values). */
export interface PhotoFilterColor {
  r: number;
  g: number;
  b: number;
}

export interface PhotoFilterState {
  /** The filter colour, 8-bit (Photoshop shows this as the colour swatch). */
  color: PhotoFilterColor;
  /** Filter strength, 0..100 (%). Photoshop's default is 25. */
  density: number;
  /** Keep overall brightness constant (Photoshop's "Preserve Luminosity").
   *  Honoured by both the direct adjustment and the kind-11 layer. */
  preserveLuminosity: boolean;
}

// Rec.601 luminance weights — MUST match the engine.
export const LUMA_R = 0.299;
export const LUMA_G = 0.587;
export const LUMA_B = 0.114;

export const DENSITY_MIN = 0;
export const DENSITY_MAX = 100;
export const DEFAULT_DENSITY = 25;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
const byte = (n: number): number => Math.round(clamp01(n) * 255);

export interface PhotoFilterPreset {
  name: string;
  color: PhotoFilterColor;
}

// Photoshop's named Photo Filter presets (8-bit sRGB). Warming/Cooling conversion
// filters, the saturated colour filters, plus Sepia / Deep / Underwater.
export const PHOTO_FILTER_PRESETS: readonly PhotoFilterPreset[] = [
  { name: "Warming Filter (85)", color: { r: 236, g: 138, b: 0 } },
  { name: "Warming Filter (LBA)", color: { r: 250, g: 150, b: 0 } },
  { name: "Warming Filter (81)", color: { r: 235, g: 177, b: 19 } },
  { name: "Cooling Filter (80)", color: { r: 0, g: 109, b: 255 } },
  { name: "Cooling Filter (LBB)", color: { r: 0, g: 93, b: 255 } },
  { name: "Cooling Filter (82)", color: { r: 0, g: 181, b: 255 } },
  { name: "Red", color: { r: 234, g: 26, b: 26 } },
  { name: "Orange", color: { r: 243, g: 137, b: 0 } },
  { name: "Yellow", color: { r: 251, g: 251, b: 0 } },
  { name: "Green", color: { r: 25, g: 251, b: 25 } },
  { name: "Cyan", color: { r: 25, g: 251, b: 251 } },
  { name: "Blue", color: { r: 25, g: 25, b: 251 } },
  { name: "Violet", color: { r: 157, g: 26, b: 235 } },
  { name: "Magenta", color: { r: 251, g: 25, b: 251 } },
  { name: "Sepia", color: { r: 172, g: 122, b: 51 } },
  { name: "Deep Red", color: { r: 255, g: 0, b: 0 } },
  { name: "Deep Blue", color: { r: 0, g: 0, b: 255 } },
  { name: "Deep Emerald", color: { r: 0, g: 140, b: 0 } },
  { name: "Deep Yellow", color: { r: 255, g: 213, b: 0 } },
  { name: "Underwater", color: { r: 0, g: 194, b: 177 } },
];

export const DEFAULT_PHOTO_FILTER = PHOTO_FILTER_PRESETS[0]; // Warming Filter (85)

/** A fresh Photo Filter state: Warming (85), 25% density, preserve luminosity on
 *  (Photoshop's defaults). */
export function defaultPhotoFilter(): PhotoFilterState {
  return { color: { ...DEFAULT_PHOTO_FILTER.color }, density: DEFAULT_DENSITY, preserveLuminosity: true };
}

/** Look up a preset by name (undefined if not found). */
export function photoFilterPreset(name: string): PhotoFilterPreset | undefined {
  return PHOTO_FILTER_PRESETS.find((p) => p.name === name);
}

/** Density as the 0..1 fraction the engine uses (clamped to 0..100 first). */
export function densityFraction(density: number): number {
  return clamp(density, DENSITY_MIN, DENSITY_MAX) / 100;
}

/** The filter colour as engine fractions `[r,g,b]` in 0..1. */
export function normalizedColor(color: PhotoFilterColor): [number, number, number] {
  return [clamp(color.r, 0, 255) / 255, clamp(color.g, 0, 255) / 255, clamp(color.b, 0, 255) / 255];
}

/** Pack to the kind-11 adjustment-layer params: `Float32Array(5)` =
 *  `[fr,fg,fb,density,preserveLuminosity]`, all normalised. A layer saved before
 *  the flag existed carries only 4 and the engine reads the missing slot as 0. */
export function packPhotoFilter(state: PhotoFilterState): Float32Array {
  const [r, g, b] = normalizedColor(state.color);
  return new Float32Array([r, g, b, densityFraction(state.density), state.preserveLuminosity ? 1 : 0]);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply the filter to an 8-bit pixel exactly as the engine does: tint toward the
 *  filter colour by density, clamp, then (if preserving luminosity) rescale to the
 *  original luminance. For tests / previews without WASM. */
export function applyPhotoFilter(state: PhotoFilterState, r: number, g: number, b: number): Rgb {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const [fr, fg, fb] = normalizedColor(state.color);
  const d = densityFraction(state.density);
  let nr = clamp01(rn * (1 - d) + rn * fr * d * 2);
  let ng = clamp01(gn * (1 - d) + gn * fg * d * 2);
  let nb = clamp01(bn * (1 - d) + bn * fb * d * 2);
  if (state.preserveLuminosity) {
    const l = LUMA_R * rn + LUMA_G * gn + LUMA_B * bn;
    const nl = Math.max(LUMA_R * nr + LUMA_G * ng + LUMA_B * nb, 1e-4);
    const s = l / nl;
    nr = clamp01(nr * s);
    ng = clamp01(ng * s);
    nb = clamp01(nb * s);
  }
  return { r: byte(nr), g: byte(ng), b: byte(nb) };
}
