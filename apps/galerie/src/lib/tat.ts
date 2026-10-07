// tat — Targeted Adjustment Tool math for the Color Mixer. Sample a pixel on
// the develop canvas, find which of the eight ACR hue bands it belongs to, and
// turn a vertical drag into a per-band adjustment. Pure + DOM-free so the band
// mapping is unit-tested; DevelopView owns the canvas sampling + drag plumbing.

/** Band hue centers in degrees, in recipe order: r, o, y, g, aqua, blue,
 *  purple, magenta. Chosen so each pure secondary (yellow 60°, aqua 180°,
 *  magenta 300°) falls unambiguously in its own band. */
export const TAT_BAND_CENTERS = [0, 30, 60, 125, 180, 225, 270, 315] as const;

/** Hue (0..360°) of an sRGB pixel; achromatic pixels return 0 (the red band). */
export function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0; // gray: no meaningful hue → red band by convention
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Index (0..7) of the Color Mixer band whose center is nearest the hue. */
export function hueToBand(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < TAT_BAND_CENTERS.length; i++) {
    const raw = Math.abs(h - TAT_BAND_CENTERS[i]);
    const dist = Math.min(raw, 360 - raw); // circular distance 0..180
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Convenience: the band a sampled sRGB pixel targets. */
export function bandForPixel(r: number, g: number, b: number): number {
  return hueToBand(rgbToHue(r, g, b));
}

/** New band value from an upward drag: dyPixels is (startY − currentY), so
 *  dragging up raises the value. ~200px spans the full −1..1 range; result is
 *  clamped to the recipe band domain. */
export function tatBandValue(startValue: number, dyPixels: number): number {
  const next = startValue + dyPixels / 200;
  return Math.max(-1, Math.min(1, next));
}
