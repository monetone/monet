// Parametric split points, tone-curve TAT region lookup and point-curve presets
// (GAL-DEV-13). Engine-free (node), like toneCurve.test.ts.
import { describe, expect, it } from "vitest";

import { createDefaultRecipe, normalizeRecipe } from "./developRecipe";
import {
  buildLut,
  DEFAULT_PARAMETRIC_SPLITS,
  masterToneLut,
  matchToneCurvePreset,
  parametricCurvePoints,
  TONE_CURVE_PRESETS,
  toneRegionAt,
  type ParametricRegions,
} from "./toneCurve";

const NEUTRAL: ParametricRegions = { highlights: 0, lights: 0, darks: 0, shadows: 0 };
const MIXED: ParametricRegions = { highlights: -40, lights: 25, darks: 60, shadows: -80 };
const DIAGONAL = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

// The pre-splits implementation, kept verbatim as the byte-compat reference:
// default splits must reproduce it exactly (persisted recipes keep rendering
// the same).
function legacyParametricCurvePoints(p: ParametricRegions) {
  const xs = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const centres = { shadows: 0.1, darks: 0.35, lights: 0.65, highlights: 0.9 };
  const tri = (x: number, c: number, hw = 0.35): number => Math.max(0, 1 - Math.abs(x - c) / hw);
  const pts = xs.map((x) => {
    const w =
      tri(x, centres.shadows) * p.shadows +
      tri(x, centres.darks) * p.darks +
      tri(x, centres.lights) * p.lights +
      tri(x, centres.highlights) * p.highlights;
    const bump = 4 * x * (1 - x);
    const y = x + (w / 100) * 0.25 * bump;
    return { x, y: Math.max(0, Math.min(1, y)) };
  });
  for (let i = 1; i < pts.length; i++) if (pts[i].y < pts[i - 1].y) pts[i].y = pts[i - 1].y;
  pts[0].y = 0;
  pts[pts.length - 1].y = 1;
  return pts;
}

describe("parametricCurvePoints with splits", () => {
  it("default splits reproduce the legacy curve byte-for-byte", () => {
    for (const p of [NEUTRAL, MIXED]) {
      const now = buildLut(parametricCurvePoints(p, DEFAULT_PARAMETRIC_SPLITS));
      const omitted = buildLut(parametricCurvePoints(p));
      const legacy = buildLut(legacyParametricCurvePoints(p));
      expect(Array.from(now)).toEqual(Array.from(legacy));
      expect(Array.from(omitted)).toEqual(Array.from(legacy));
    }
  });

  it("moving the shadow split moves where the shadows slider acts", () => {
    const p: ParametricRegions = { ...NEUTRAL, shadows: 100 };
    const narrow = buildLut(parametricCurvePoints(p, [0.1, 0.5, 0.75]));
    const def = buildLut(parametricCurvePoints(p));
    expect(Array.from(narrow)).not.toEqual(Array.from(def));
    // Narrower shadow region → the lift concentrates lower: less lift at the
    // default shadow centre (0.1 * 255 ≈ 26 input ≈ where def peaked).
    expect(narrow[64]).toBeLessThan(def[64]);
  });

  it("stays neutral-identity and monotone for hostile splits", () => {
    for (const s of [[0.75, 0.5, 0.25], [NaN, 2, -1], [0.5, 0.5, 0.5]] as const) {
      const splits = s as unknown as [number, number, number];
      const id = parametricCurvePoints(NEUTRAL, splits);
      for (const pt of id) expect(pt.y).toBeCloseTo(pt.x, 6);
      const lut = buildLut(parametricCurvePoints(MIXED, splits));
      expect(lut[0]).toBe(0);
      expect(lut[255]).toBe(255);
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });

  it("masterToneLut forwards the splits", () => {
    const p: ParametricRegions = { ...NEUTRAL, shadows: 100 };
    const moved = masterToneLut(DIAGONAL, p, [0.1, 0.5, 0.75]);
    const def = masterToneLut(DIAGONAL, p);
    expect(Array.from(moved)).not.toEqual(Array.from(def));
  });
});

describe("toneRegionAt (Targeted Adjustment Tool)", () => {
  it("maps luma to the region under the default splits", () => {
    expect(toneRegionAt(0.1)).toBe("shadows");
    expect(toneRegionAt(0.3)).toBe("darks");
    expect(toneRegionAt(0.6)).toBe("lights");
    expect(toneRegionAt(0.9)).toBe("highlights");
  });

  it("honours moved splits", () => {
    expect(toneRegionAt(0.3, [0.4, 0.6, 0.8])).toBe("shadows");
    expect(toneRegionAt(0.9, [0.4, 0.6, 0.95])).toBe("lights");
  });
});

describe("point-curve presets", () => {
  it("Linear is the identity; Medium/Strong are monotone S-curves pinned at the midpoint", () => {
    const linear = TONE_CURVE_PRESETS.find((p) => p.id === "linear")!;
    expect(Array.from(buildLut([...linear.points]))).toEqual(Array.from(buildLut(DIAGONAL)));
    for (const id of ["medium", "strong"] as const) {
      const lut = buildLut([...TONE_CURVE_PRESETS.find((p) => p.id === id)!.points]);
      expect(lut[0]).toBe(0);
      expect(lut[128]).toBe(128);
      expect(lut[255]).toBe(255);
      expect(lut[32]).toBeLessThan(32); // darkened shadows…
      expect(lut[224]).toBeGreaterThan(224); // …brightened highlights
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
    // Strong really is stronger than Medium in the shadows.
    const medium = buildLut([...TONE_CURVE_PRESETS.find((p) => p.id === "medium")!.points]);
    const strong = buildLut([...TONE_CURVE_PRESETS.find((p) => p.id === "strong")!.points]);
    expect(strong[32]).toBeLessThan(medium[32]);
  });

  it("matchToneCurvePreset round-trips every preset (through a clone) and rejects custom points", () => {
    for (const p of TONE_CURVE_PRESETS) {
      expect(matchToneCurvePreset(p.points.map((q) => ({ ...q })))).toBe(p.id);
    }
    expect(matchToneCurvePreset([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe("normalizeRecipe splits hardening", () => {
  it("forces hostile splits ascending and in range", () => {
    const r = createDefaultRecipe();
    const hostile = { ...r, toneCurve: { ...r.toneCurve, parametricSplits: [0.9, Number.NaN, 0.2] } };
    expect(normalizeRecipe(hostile).toneCurve.parametricSplits).toEqual([0.2, 0.5, 0.9]);
  });
});
