// ─────────────────────────────────────────────────────────────
// color — RGBA model + conversions (engine-local, framework-free)
// ─────────────────────────────────────────────────────────────
// Channels r,g,b are 0..255 integers; alpha a is 0..1. This matches what the
// UI shows (hex / 0-255) while keeping alpha as a fraction for compositing.

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export const toCSS = (c: RGBA): string =>
  c.a >= 1
    ? `rgb(${clamp255(c.r)},${clamp255(c.g)},${clamp255(c.b)})`
    : `rgba(${clamp255(c.r)},${clamp255(c.g)},${clamp255(c.b)},${+clamp01(c.a).toFixed(3)})`;

export const toHex = (c: RGBA, withAlpha = false): string => {
  const h = (v: number) => clamp255(v).toString(16).padStart(2, "0");
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return withAlpha ? `${base}${h(c.a * 255)}` : base.toUpperCase();
};

export const fromHex = (hex: string): RGBA => {
  let s = hex.trim().replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length === 4) s = s.split("").map((ch) => ch + ch).join("");
  const r = parseInt(s.slice(0, 2), 16) || 0;
  const g = parseInt(s.slice(2, 4), 16) || 0;
  const b = parseInt(s.slice(4, 6), 16) || 0;
  const a = s.length >= 8 ? (parseInt(s.slice(6, 8), 16) || 0) / 255 : 1;
  return { r, g, b, a };
};

export const rgbToHsv = (c: RGBA): HSV => {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
};

export const hsvToRgb = (hsv: HSV, a = 1): RGBA => {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp01(hsv.s);
  const v = clamp01(hsv.v);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255), a };
};

export const mix = (a: RGBA, b: RGBA, t: number): RGBA => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
  a: a.a + (b.a - a.a) * t,
});

export const withAlpha = (c: RGBA, a: number): RGBA => ({ ...c, a: clamp01(a) });

/** Illustrator's "Invert": photographic negative — 255 − each RGB channel
 *  (alpha preserved). */
export const invert = (c: RGBA): RGBA => ({ r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a });

/** Illustrator's Color panel "Complement": reflect each channel about the midpoint
 *  of the colour's lightest and darkest channels — new = (max + min) − channel. This
 *  rotates the hue ~180° while keeping the brightness range (greys map to themselves).
 *  Alpha is preserved. */
export const complement = (c: RGBA): RGBA => {
  const sum = Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b);
  return { r: sum - c.r, g: sum - c.g, b: sum - c.b, a: c.a };
};

export const equals = (a: RGBA, b: RGBA): boolean =>
  clamp255(a.r) === clamp255(b.r) &&
  clamp255(a.g) === clamp255(b.g) &&
  clamp255(a.b) === clamp255(b.b) &&
  Math.abs(a.a - b.a) < 1e-3;

/** Perceptual luminance 0..1 (for choosing readable foregrounds). */
export const luminance = (c: RGBA): number => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;

/** Approximate RGB → CMYK (0..100 each) for the CMYK readout. */
export const rgbToCmyk = (c: RGBA): { c: number; m: number; y: number; k: number } => {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
};
