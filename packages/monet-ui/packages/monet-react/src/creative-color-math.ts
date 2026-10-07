// ─────────────────────────────────────────────────────────────
// Monet — creative color math + paint helpers (pure, no JSX)
// ─────────────────────────────────────────────────────────────
// Pure, framework-free color-space conversions plus a few CSS paint string
// builders. A `.ts` (not `.tsx`) sibling so the zero-dep `node:test` suite can
// import it directly — Node 24 strips `.ts` types but refuses `.tsx`. It is
// re-exported by creative-color-graphics.tsx → creative-color.tsx, so the
// public surface stays a single module (mirrors primitives-graphics).
//
// CANONICAL state is HSV { h:0..360, s:0..1, v:0..1, a?:0..1 }. hex/rgb are
// always DERIVED — never the source of truth, because hex loses the hue at
// s=0 (every grey is "#nnnnnn"). The round-trip conversions below preserve the
// HSV hue across an RGB hop only up to that inherent ambiguity (greys snap to
// hue 0), which is exactly what a color picker wants.
//
// All conversions are unit-tested in test/creative-color-math.test.ts.
//
// This module has NO relative imports on purpose (like dockable-core.ts): the
// node:test loader strips a self-contained `.ts` but cannot resolve a bundler-
// style extensionless `./internal` specifier. `clamp`/`roundTo` mirror the
// trivial ./internal helpers — kept local so the math stays node-testable.

/** Clamp `n` to the inclusive [min, max] range (mirrors ./internal). */
function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}
/** Round `n` to `decimals` places, avoiding binary-float dust (mirrors ./internal). */
function roundTo(n: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// ─── value types ───────────────────────────────────────────────

/** Canonical color: hue 0..360, saturation/value/alpha 0..1. */
export interface HSV {
  h: number;
  s: number;
  v: number;
  /** Alpha 0..1. Treated as 1 when omitted. */
  a?: number;
}

/** An RGB triple, each channel 0..255 (alpha 0..1 when present). */
export interface RGB {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** A color accepted by the color components: either canonical HSV or a hex
 *  string ("#rgb" / "#rrggbb" / "#rrggbbaa"). */
export type ColorValue = HSV | string;

// ─── small scalar helpers ──────────────────────────────────────

const mod360 = (h: number): number => ((h % 360) + 360) % 360;
const u8 = (n: number): number => clamp(Math.round(n), 0, 255);
const hex2 = (n: number): string => u8(n).toString(16).padStart(2, "0");

// ─── conversions ───────────────────────────────────────────────

/** HSV → RGB (channels 0..255). Alpha is passed through untouched. */
export function hsvToRgb(hsv: HSV): RGB {
  const h = mod360(hsv.h);
  const s = clamp(hsv.s, 0, 1);
  const v = clamp(hsv.v, 0, 1);
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  const out: RGB = { r: u8((r + m) * 255), g: u8((g + m) * 255), b: u8((b + m) * 255) };
  if (hsv.a != null) out.a = clamp(hsv.a, 0, 1);
  return out;
}

/** RGB (0..255) → HSV. Greys (max==min) report hue 0 (the hue is undefined,
 *  but canonical state needs a number — pickers keep their own hue separately
 *  via the controlled HSV, so this only matters for a fresh hex parse). */
export function rgbToHsv(rgb: RGB): HSV {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;
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
  const out: HSV = { h: roundTo(h, 2), s: roundTo(s, 4), v: roundTo(max, 4) };
  if (rgb.a != null) out.a = clamp(rgb.a, 0, 1);
  return out;
}

/** RGB (0..255) → "#rrggbb" (or "#rrggbbaa" when alpha < 1 is present). */
export function rgbToHex(rgb: RGB): string {
  const base = `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`;
  if (rgb.a != null && rgb.a < 1) return base + hex2(rgb.a * 255);
  return base;
}

/** "#rgb" / "#rrggbb" / "#rrggbbaa" → RGB. Returns null on an unparseable
 *  string so callers can keep the previous value. */
export function hexToRgb(hex: string): RGB | null {
  const s = hex.trim().replace(/^#/, "");
  const ok = /^[0-9a-fA-F]+$/.test(s);
  if (!ok) return null;
  let r: number, g: number, b: number, a: number | undefined;
  if (s.length === 3) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
  } else if (s.length === 4) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
    a = parseInt(s[3] + s[3], 16) / 255;
  } else if (s.length === 6) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
  } else if (s.length === 8) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
    a = parseInt(s.slice(6, 8), 16) / 255;
  } else {
    return null;
  }
  const out: RGB = { r, g, b };
  if (a != null) out.a = roundTo(a, 4);
  return out;
}

/** HSV → "#rrggbb" (alpha dropped — use the RGB path when you need "#rrggbbaa").
 *  Alpha is intentionally excluded so a hex swatch stays a 6-digit value. */
export function hsvToHex(hsv: HSV): string {
  const { r, g, b } = hsvToRgb(hsv);
  return rgbToHex({ r, g, b });
}

/** "#…" hex → HSV. Returns null on an unparseable string. Alpha (if any) is
 *  carried onto the result. */
export function hexToHsv(hex: string): HSV | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

// ─── ColorValue normalization (used by components) ─────────────

/** Coerce a ColorValue (HSV or hex string) to canonical HSV. Falls back to the
 *  supplied default when a hex string fails to parse. */
export function toHsv(value: ColorValue, fallback: HSV = { h: 0, s: 0, v: 0 }): HSV {
  if (typeof value === "string") return hexToHsv(value) ?? fallback;
  return value;
}

/** A CSS `rgb()/rgba()` paint string for an HSV (honors alpha). */
export function hsvToCss(hsv: HSV): string {
  const { r, g, b } = hsvToRgb(hsv);
  const a = hsv.a == null ? 1 : clamp(hsv.a, 0, 1);
  return a < 1 ? `rgba(${r}, ${g}, ${b}, ${roundTo(a, 3)})` : `rgb(${r}, ${g}, ${b})`;
}

/** A CSS paint string for any ColorValue. */
export function colorToCss(value: ColorValue): string {
  return hsvToCss(toHsv(value));
}

// ─── paint string builders (saturation/value square, hue, gradient) ─────

/** The CSS background for a saturation×value square at a fixed hue: a white→hue
 *  horizontal layer multiplied by a transparent→black vertical layer. Returns a
 *  single `background` shorthand value. */
export function satValSquareBg(hue: number): string {
  const pure = hsvToCss({ h: mod360(hue), s: 1, v: 1 });
  return `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})`;
}

/** The full 0..360 hue rainbow as a CSS linear-gradient, in the given axis. */
export function hueRainbowBg(toRight = true): string {
  const dir = toRight ? "to right" : "to top";
  const stops: string[] = [];
  for (let h = 0; h <= 360; h += 60) stops.push(`${hsvToCss({ h, s: 1, v: 1 })} ${(h / 360) * 100}%`);
  return `linear-gradient(${dir}, ${stops.join(", ")})`;
}

/** A CSS gradient string for a list of {offset,color} stops, sorted by offset.
 *  `type` "linear" honors `angle` (deg); "radial" centers a radial-gradient. */
export function gradientCss(
  stops: Array<{ offset: number; color: ColorValue }>,
  type: "linear" | "radial" = "linear",
  angle = 90,
): string {
  const parts = [...stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${colorToCss(s.color)} ${roundTo(clamp(s.offset, 0, 1) * 100, 2)}%`);
  if (parts.length === 0) return "transparent";
  if (parts.length === 1) parts.push(parts[0]);
  return type === "radial"
    ? `radial-gradient(circle at center, ${parts.join(", ")})`
    : `linear-gradient(${roundTo(angle, 2)}deg, ${parts.join(", ")})`;
}

/** Linear-interpolate a color at `offset` between the two stops that bracket
 *  it (used when click-adding a gradient stop). Operates in RGBA space. */
export function sampleGradient(
  stops: Array<{ offset: number; color: ColorValue }>,
  offset: number,
): HSV {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (sorted.length === 0) return { h: 0, s: 0, v: 0 };
  const t = clamp(offset, 0, 1);
  if (t <= sorted[0].offset) return toHsv(sorted[0].color);
  const last = sorted[sorted.length - 1];
  if (t >= last.offset) return toHsv(last.color);
  let lo = sorted[0];
  let hi = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].offset && t <= sorted[i + 1].offset) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  const span = hi.offset - lo.offset || 1;
  const f = (t - lo.offset) / span;
  const a = hsvToRgb(toHsv(lo.color));
  const b = hsvToRgb(toHsv(hi.color));
  const mix = (x: number, y: number) => x + (y - x) * f;
  const aa = a.a == null ? 1 : a.a;
  const ba = b.a == null ? 1 : b.a;
  return rgbToHsv({
    r: mix(a.r, b.r),
    g: mix(a.g, b.g),
    b: mix(a.b, b.b),
    a: roundTo(mix(aa, ba), 4),
  });
}
