// ─────────────────────────────────────────────────────────────
// Replace Color (Image ▸ Adjustments ▸ Replace Color) — soft colour selection +
// hue/sat/lightness shift.
//
// Selects pixels near a target colour (Fuzziness controls the radius in RGB
// space), then applies a Hue/Saturation/Lightness shift blended by how strongly
// each pixel is selected. Engine-free so it unit-tests in node; the HSL shift
// reuses the exact `rgbToHsl`/`hslToRgb` mirror from `./hueSaturation`.
//
// The math MUST match `adjust.rs replace_color`: `radius = max(fuzz/200·√3, 1e-3)`;
// `weight = clamp(1 − dist/radius, 0, 1)` (Euclidean RGB distance to target); where
// `weight > 0`, shift HSL by (hue, sat, light) like Hue/Saturation, then blend
// `out = orig + (shifted − orig)·weight`. The dialog's target is the foreground
// colour (supplied engine-side); `applyReplaceColor` takes it explicitly for tests.
// Mirrors `hueSaturation.ts` house style.
// ─────────────────────────────────────────────────────────────

import { rgbToHsl, hslToRgb } from "./hueSaturation";

export interface ReplaceColorAdjust {
  /** Fuzziness 0..200 — the selection radius (Photoshop's slider). */
  fuzziness: number;
  /** Hue rotation in degrees (−180..180). */
  hue: number;
  /** Saturation in Photoshop units (−100..100). */
  saturation: number;
  /** Lightness in Photoshop units (−100..100). */
  lightness: number;
}

export const FUZZINESS_MIN = 0;
export const FUZZINESS_MAX = 200;
// The maximum Euclidean distance between two normalised RGB colours (black↔white).
export const MAX_RGB_DISTANCE = Math.sqrt(3);

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit — bit-exact with the engine's `to8` (color.rs).
const byte = (n: number): number => Math.round(clamp01(n) * 255);
// Positive modulo (matches Rust `rem_euclid`).
const mod360 = (n: number): number => ((n % 360) + 360) % 360;

/** A fresh Replace Color adjustment (mild fuzziness, no shift). */
export function defaultReplaceColor(): ReplaceColorAdjust {
  return { fuzziness: 40, hue: 0, saturation: 0, lightness: 0 };
}

/** The four scalars the engine / `store.replaceColor` take (target = foreground):
 *  `[fuzziness, hue, sat, light]` with sat/light as −1..1 fractions. */
export function replaceColorEngineArgs(adj: ReplaceColorAdjust): [number, number, number, number] {
  return [adj.fuzziness, adj.hue, adj.saturation / 100, adj.lightness / 100];
}

/** Selection radius in normalised RGB space: `fuzz/200 · √3`, floored at 1e-3 so a
 *  zero-fuzz selection still matches the exact target (and never divides by zero).
 *  Not upper-clamped — mirrors the engine, where fuzz > 200 keeps widening the
 *  radius past √3 (selecting everything). */
export function selectionRadius(fuzziness: number): number {
  return Math.max((fuzziness / 200) * MAX_RGB_DISTANCE, 1e-3);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Selection weight (0..1) of an 8-bit pixel against an 8-bit `target`, given
 *  `fuzziness`: 1 at the target, falling linearly to 0 at the radius. */
export function selectionWeight(target: Rgb, fuzziness: number, r: number, g: number, b: number): number {
  const dr = (r - target.r) / 255;
  const dg = (g - target.g) / 255;
  const db = (b - target.b) / 255;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  return clamp01(1 - dist / selectionRadius(fuzziness));
}

/** Apply Replace Color to an 8-bit pixel exactly as the engine does: weight the
 *  pixel by closeness to `target`, apply the HSL hue/sat/light shift, blend by
 *  weight. Matches the engine to 8-bit precision (this runs in f64; the engine's
 *  pipeline is f32). For tests / previews. */
export function applyReplaceColor(adj: ReplaceColorAdjust, target: Rgb, r: number, g: number, b: number): Rgb {
  const w = selectionWeight(target, adj.fuzziness, r, g, b);
  if (w <= 0) return { r, g, b };
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const hsl = rgbToHsl(rn, gn, bn);
  const sat = adj.saturation / 100;
  const light = adj.lightness / 100;
  const h = mod360(hsl.h + adj.hue);
  const s = clamp01(hsl.s * (1 + sat));
  const l = light >= 0 ? hsl.l + (1 - hsl.l) * light : hsl.l * (1 + light);
  const sh = hslToRgb(h, s, l);
  return {
    r: byte(rn + (sh.r - rn) * w),
    g: byte(gn + (sh.g - gn) * w),
    b: byte(bn + (sh.b - bn) * w),
  };
}
