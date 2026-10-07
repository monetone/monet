import { describe, expect, it } from "vitest";

import {
  CURRENT_PROCESS_VERSION,
  CURRENT_RECIPE_VERSION,
  createDefaultRecipe,
  normalizeRecipe,
} from "./developRecipe";

describe("createDefaultRecipe", () => {
  it("is versioned, neutral, and JSON round-trips", () => {
    const d = createDefaultRecipe();
    expect(d.version).toBe(CURRENT_RECIPE_VERSION);
    expect(d.processVersion).toBe(CURRENT_PROCESS_VERSION);
    expect(d.basic.exposure).toBe(0);
    expect(d.toneCurve.point).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(d.masks.masks).toEqual([]);
    // No functions/undefined: safe to persist as JSON.
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});

describe("normalizeRecipe", () => {
  it("fills missing fields from defaults and stamps the version", () => {
    const r = normalizeRecipe({ basic: { exposure: 1.5 } });
    expect(r.version).toBe(CURRENT_RECIPE_VERSION);
    expect(r.processVersion).toBe(CURRENT_PROCESS_VERSION);
    expect(r.basic.exposure).toBe(1.5);
    expect(r.basic.contrast).toBe(0); // default filled
    expect(r.detail.sharpenRadius).toBe(1); // whole panel defaulted
  });

  it("returns a default recipe for null/garbage input", () => {
    expect(normalizeRecipe(null)).toEqual(createDefaultRecipe());
    expect(normalizeRecipe(42)).toEqual(createDefaultRecipe());
  });

  it("preserves a provided mask graph", () => {
    const masks = { masks: [{ id: "m", name: "M", enabled: true, inverted: false, opacity: 1, components: [], adjustments: {} }] };
    const r = normalizeRecipe({ version: 2, masks });
    expect(r.masks.masks).toHaveLength(1);
  });

  it("rejects a recipe declaring a foreign version/processVersion", () => {
    // The version fields are plain discriminators for the CURRENT format — a
    // document claiming anything else is foreign, not something to upgrade.
    const d = createDefaultRecipe();
    expect(normalizeRecipe({ ...d, version: 1, basic: { ...d.basic, exposure: 2 } })).toEqual(d);
    expect(normalizeRecipe({ ...d, version: 3 })).toEqual(d);
    expect(normalizeRecipe({ ...d, processVersion: 5, basic: { ...d.basic, exposure: 2 } })).toEqual(d);
  });

  it("deep-fills partial nested wheels so the ABI never sees NaN", () => {
    const r = normalizeRecipe({
      version: 2,
      colorGrading: { shadows: { hue: 210 } }, // sat/lum omitted
      toneCurve: { parametric: { lights: 20 } }, // highlights/darks/shadows omitted
    });
    // A shallow merge would have left sat/lum undefined → NaN in the Grade ABI.
    expect(r.colorGrading.shadows).toEqual({ hue: 210, sat: 0, lum: 0 });
    expect(r.colorGrading.midtones).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(r.colorGrading.global).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(r.toneCurve.parametric).toEqual({ highlights: 0, lights: 20, darks: 0, shadows: 0 });
    for (const n of [r.colorGrading.shadows.sat, r.colorGrading.shadows.lum, r.toneCurve.parametric.darks]) {
      expect(Number.isNaN(n)).toBe(false);
    }
  });

  it("preserves a boolean removeChromaticAberration (canonical/digest stable)", () => {
    // The canonical fixture carries the boolean CA field, no `aberration`.
    // normalizeRecipe keeps the boolean verbatim and does NOT inject
    // `aberration`, so the recipe's canonical bytes/digest are unchanged (the
    // ABI reads the boolean → p[1051]).
    const d = createDefaultRecipe();
    const withBool = { ...d, optics: { ...d.optics, removeChromaticAberration: true } } as Record<string, unknown>;
    delete (withBool.optics as { aberration?: number }).aberration;
    const r = normalizeRecipe(withBool);
    expect((r.optics as { removeChromaticAberration?: boolean }).removeChromaticAberration).toBe(true);
    expect((r.optics as { aberration?: number }).aberration).toBeUndefined();
  });
});

describe("heal panel", () => {
  it("defaults to no spots and normalize fills an absent panel", () => {
    expect(createDefaultRecipe().heal).toEqual({ spots: [] });
    const partial = JSON.parse(JSON.stringify(createDefaultRecipe())) as Record<string, unknown>;
    delete partial.heal;
    expect(normalizeRecipe(partial).heal).toEqual({ spots: [] });
  });

  it("round-trips stored spots through normalize", () => {
    const r = createDefaultRecipe();
    r.heal.spots = [
      { mode: "clone", x: 0.5, y: 0.5, sourceX: 0.6, sourceY: 0.5, radius: 0.02, feather: 0.5, opacity: 1 },
    ];
    const n = normalizeRecipe(JSON.parse(JSON.stringify(r)));
    expect(n.heal.spots).toEqual(r.heal.spots);
  });
});
