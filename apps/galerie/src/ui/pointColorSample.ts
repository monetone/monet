// Point Color eyedropper helpers — the pure logic behind sampling a pixel into a
// develop Point Color socket. Kept out of the React view so it is unit-testable.

import type { PointColorSample } from "@monet-ui/monet-photo";

/** RGB (0..255) → HSL, matching the engine's `color::rgb_to_hsl`
 *  (hue 0..360°, saturation/luminance 0..1) so a sampled swatch selects the same
 *  pixels the renderer does. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max - min < 1e-6) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** A neutral Point Color socket referencing a sampled pixel: it selects the
 *  sampled colour (srcHue/srcSat/srcLum = engine refHue/refSat/refLum) with no
 *  hue/sat/lum shift yet and a mid selection range. */
export function sampleToSocket(r: number, g: number, b: number): PointColorSample {
  const [srcHue, srcSat, srcLum] = rgbToHsl(r, g, b);
  return { srcHue, srcSat, srcLum, hue: 0, sat: 0, lum: 0, range: 0.5 };
}
