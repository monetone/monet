// sRGB ↔ CIE Lab D50 for Photoshop's Info-panel Lab readout and Lab colours read
// from Photoshop files. Photoshop's Lab is D50 (the ICC connection space), so sRGB
// goes through its ICC colorants, Bradford-adapted to D50 — the same model as the
// engine's Lab plates. Pure / engine-free so it unit-tests in node. rgbToLab rounds
// each component to an integer; neutral greys yield a*=b*=0.

const SRGB_TO_XYZ_D50 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];
const XYZ_D50_TO_SRGB = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.033454],
  [0.0719453, -0.2289914, 1.4052427],
];
/** The D50 white those colorants sum to, so every neutral lands on a = b = 0. */
const D50 = [0.96422, 1, 0.82521];

const mul = (m: number[][], v: number[]) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

// sRGB 0-255 channel → linear-light 0..1 (the standard sRGB transfer curve).
function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// Lab f(t): cube root above the linear-segment threshold, else the affine fallback.
function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const [fx, fy, fz] = mul(SRGB_TO_XYZ_D50, [linear(r), linear(g), linear(b)]).map((v, i) => f(v / D50[i]));
  // `|| 0` folds the -0 that rounding near-zero negatives can produce into +0.
  const round0 = (n: number) => Math.round(n) || 0;
  return {
    l: round0(116 * fy - 16),
    a: round0(500 * (fx - fy)),
    b: round0(200 * (fy - fz)),
  };
}

/** CIE Lab D50 → sRGB 0..255 (unrounded, clamped), the inverse of rgbToLab. */
export function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const inv = (t: number) => (t > 0.20689655 ? t * t * t : (t - 16 / 116) / 7.787);
  const xyz = [fy + a / 500, fy, fy - b / 200].map((t, i) => inv(t) * D50[i]);
  const encode = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
  const [sr, sg, sb] = mul(XYZ_D50_TO_SRGB, xyz).map((c) => Math.min(1, Math.max(0, encode(c))) * 255);
  return [sr, sg, sb];
}
