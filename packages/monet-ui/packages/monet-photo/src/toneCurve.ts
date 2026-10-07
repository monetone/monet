// Tone-curve LUT building for the Curves dialog's per-channel editing. Engine-free
// so it unit-tests in node; the dialog feeds the four LUTs to engine adjust_curves.
// Points are structural ({x,y} in 0..1), so this stays free of the monet-ui
// CurvePoint type and node-safe.
export type CurvePointLike = { x: number; y: number };

// The Curves Channel dropdown: 0 = RGB (composite/master), 1/2/3 = R/G/B.
export const CURVE_CHANNELS = [
  { value: 0, label: "RGB" },
  { value: 1, label: "Red" },
  { value: 2, label: "Green" },
  { value: 3, label: "Blue" },
] as const;

export function identityLut(): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  return lut;
}

// A 256-entry LUT from control points (x,y in 0..1) by piecewise-linear
// interpolation between sorted points; output clamped to [0,255]. The identity
// diagonal [{0,0},{1,1}] yields lut[i]===i.
export function buildLut(points: readonly CurvePointLike[]): Uint8Array {
  if (points.length === 0) return identityLut();
  const pts = [...points].sort((a, b) => a.x - b.x);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let p0 = pts[0], p1 = pts[pts.length - 1];
    for (let k = 0; k < pts.length - 1; k++) {
      if (t >= pts[k].x && t <= pts[k + 1].x) { p0 = pts[k]; p1 = pts[k + 1]; break; }
    }
    const span = p1.x - p0.x || 1e-6;
    const f = Math.max(0, Math.min(1, (t - p0.x) / span));
    const y = p0.y + (p1.y - p0.y) * f;
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

// Build the four LUTs engine adjust_curves(master,r,g,b) expects from per-channel
// point arrays. Index 0 = master/composite (RGB), 1/2/3 = R/G/B. A channel left at
// the identity diagonal yields the identity LUT (no-op), so editing only Red routes
// the edited LUT to the r slot while master/g/b stay identity.
export function buildCurveLuts(ptsByChannel: readonly (readonly CurvePointLike[])[]): {
  master: Uint8Array; r: Uint8Array; g: Uint8Array; b: Uint8Array;
} {
  return {
    master: buildLut(ptsByChannel[0] ?? []),
    r: buildLut(ptsByChannel[1] ?? []),
    g: buildLut(ptsByChannel[2] ?? []),
    b: buildLut(ptsByChannel[3] ?? []),
  };
}

/** Parametric tone-region sliders (Lightroom/ACR Highlights/Lights/Darks/Shadows,
 *  each -100..100). Shared by Galerie and Vision (Camera Raw). */
export interface ParametricRegions {
  highlights: number;
  lights: number;
  darks: number;
  shadows: number;
}

/** Parametric region split points (shadows/darks, darks/lights, lights/highlights), 0..1. */
export type ParametricSplits = readonly [number, number, number];

export const DEFAULT_PARAMETRIC_SPLITS: ParametricSplits = [0.25, 0.5, 0.75];

// Recipes come from catalog/XMP text, so splits are sanitized here too: clamp
// each into (0,1) and force ascending order so degenerate values can't fold the
// regions or divide by zero.
function orderedSplits(splits?: ParametricSplits): [number, number, number] {
  const raw = splits ?? DEFAULT_PARAMETRIC_SPLITS;
  const c = [0, 1, 2].map((i) => {
    const v = raw[i];
    const d = DEFAULT_PARAMETRIC_SPLITS[i];
    return Number.isFinite(v) ? Math.max(0.02, Math.min(0.98, v)) : d;
  });
  c.sort((a, b) => a - b);
  return c as [number, number, number];
}

// ACR parametric-tone regions → monotone, endpoint-pinned control points that feed
// buildLut. Neutral (all 0) yields the identity diagonal. Each region slider bumps
// a tonal band centred on its zone; the bump vanishes at x=0/1 so the endpoints
// stay pinned to (0,0)/(1,1), and the result is forced non-decreasing.
// The three split points move the region boundaries (LR's triangles under the
// graph); the default splits reproduce the historical hardcoded knots exactly.
export function parametricCurvePoints(p: ParametricRegions, splits?: ParametricSplits): CurvePointLike[] {
  const [s1, s2, s3] = orderedSplits(splits);
  // Knots at each boundary and each region midpoint; at the default splits this
  // is the historical [0, .125, .25, .375, .5, .625, .75, .875, 1].
  const xs = [0, s1 / 2, s1, (s1 + s2) / 2, s2, (s2 + s3) / 2, s3, (s3 + 1) / 2, 1];
  // Region centres sit 40% into the two dark regions and 60% into the two light
  // ones — at default splits that's the historical 0.1 / 0.35 / 0.65 / 0.9.
  const centres = {
    shadows: 0.4 * s1,
    darks: s1 + 0.4 * (s2 - s1),
    lights: s2 + 0.6 * (s3 - s2),
    highlights: s3 + 0.6 * (1 - s3),
  };
  const tri = (x: number, c: number, hw = 0.35): number => Math.max(0, 1 - Math.abs(x - c) / hw);
  const pts = xs.map((x) => {
    const w =
      tri(x, centres.shadows) * p.shadows +
      tri(x, centres.darks) * p.darks +
      tri(x, centres.lights) * p.lights +
      tri(x, centres.highlights) * p.highlights;
    const bump = 4 * x * (1 - x); // vanishes at x=0 and x=1 → endpoints pinned
    const y = x + (w / 100) * 0.25 * bump;
    return { x, y: Math.max(0, Math.min(1, y)) };
  });
  // Region sliders can otherwise fold the curve back — enforce non-decreasing.
  for (let i = 1; i < pts.length; i++) if (pts[i].y < pts[i - 1].y) pts[i].y = pts[i - 1].y;
  pts[0].y = 0;
  pts[pts.length - 1].y = 1;
  return pts;
}

// The master tone LUT: the master point curve with the parametric regions composed
// after it (paramLut ∘ pointLut). Neutral parametric leaves the point curve
// unchanged (identity ∘ pointLut = pointLut), so an untouched recipe is a no-op.
export function masterToneLut(
  masterPoints: readonly CurvePointLike[],
  parametric: ParametricRegions,
  splits?: ParametricSplits,
): Uint8Array {
  const paramLut = buildLut(parametricCurvePoints(parametric, splits));
  const pointLut = buildLut(masterPoints);
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) out[i] = paramLut[pointLut[i]];
  return out;
}

/** The parametric region under a luma value (0..1) — what the tone-curve
 *  Targeted Adjustment Tool adjusts when dragging on the image. */
export function toneRegionAt(luma: number, splits?: ParametricSplits): keyof ParametricRegions {
  const [s1, s2, s3] = orderedSplits(splits);
  return luma < s1 ? "shadows" : luma < s2 ? "darks" : luma < s3 ? "lights" : "highlights";
}

/** LR's Point Curve presets (ACR's classic Linear / Medium / Strong Contrast
 *  point sets, normalized 0..1). `points` are frozen templates — clone before
 *  storing into a recipe. */
export const TONE_CURVE_PRESETS: readonly {
  id: "linear" | "medium" | "strong";
  label: string;
  points: readonly CurvePointLike[];
}[] = [
  { id: "linear", label: "Linear", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  {
    id: "medium",
    label: "Medium Contrast",
    // ACR "Medium Contrast": (32,22) (64,56) (128,128) (192,196) on 0..255.
    points: [
      { x: 0, y: 0 }, { x: 32 / 255, y: 22 / 255 }, { x: 64 / 255, y: 56 / 255 },
      { x: 128 / 255, y: 128 / 255 }, { x: 192 / 255, y: 196 / 255 }, { x: 1, y: 1 },
    ],
  },
  {
    id: "strong",
    label: "Strong Contrast",
    // ACR "Strong Contrast": (32,16) (64,50) (128,128) (192,202) on 0..255.
    points: [
      { x: 0, y: 0 }, { x: 32 / 255, y: 16 / 255 }, { x: 64 / 255, y: 50 / 255 },
      { x: 128 / 255, y: 128 / 255 }, { x: 192 / 255, y: 202 / 255 }, { x: 1, y: 1 },
    ],
  },
];

/** Which preset (if any) the given master point curve matches, for the preset
 *  menu's current value. Tolerant of float noise; null → "Custom". */
export function matchToneCurvePreset(points: readonly CurvePointLike[]): "linear" | "medium" | "strong" | null {
  for (const p of TONE_CURVE_PRESETS) {
    if (
      p.points.length === points.length &&
      p.points.every((q, i) => Math.abs(q.x - points[i].x) < 1e-3 && Math.abs(q.y - points[i].y) < 1e-3)
    ) {
      return p.id;
    }
  }
  return null;
}
