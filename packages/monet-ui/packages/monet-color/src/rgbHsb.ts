// ─────────────────────────────────────────────────────────────
// RGB → HSB — pure conversion for the Info panel's HSB readout (Photoshop). HSB is
// Hue 0-360°, Saturation 0-100%, Brightness 0-100% (all rounded), matching the
// Info panel display. Engine-free so it unit-tests in node.
// ─────────────────────────────────────────────────────────────

export interface Hsb {
  h: number;
  s: number;
  b: number;
}

/** 8-bit RGB → Photoshop HSB (h 0-360°, s/b 0-100%, rounded). */
export function rgbToHsb(r: number, g: number, b: number): Hsb {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  // `% 360` wraps a hue that rounds up to 360° back to 0° (Photoshop shows 0°).
  return { h: Math.round(h) % 360, s: Math.round(s * 100), b: Math.round(max * 100) };
}
