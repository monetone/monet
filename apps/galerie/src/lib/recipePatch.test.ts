import { createDefaultRecipe } from "@monet-ui/monet-photo";
import { describe, expect, it } from "vitest";

import { mergeRecipePatch } from "./recipePatch";

describe("mergeRecipePatch", () => {
  it("overlays patched fields while preserving the baseline's untouched ones", () => {
    const base = createDefaultRecipe();
    base.basic.exposure = 0.1;
    base.basic.temp = 0.3; // NOT in the patch — must survive
    base.crop.rect = { top: 0.1, left: 0.1, bottom: 0.9, right: 0.9 };

    const merged = mergeRecipePatch(base, { basic: { exposure: 0.5, contrast: 0.2 } });

    expect(merged.basic.exposure).toBeCloseTo(0.5, 6); // patched
    expect(merged.basic.contrast).toBeCloseTo(0.2, 6); // patched
    expect(merged.basic.temp).toBeCloseTo(0.3, 6); // baseline preserved, not reset
    expect(merged.crop.rect.left).toBeCloseTo(0.1, 6); // untouched panel preserved
  });

  it("deep-merges a two-level panel (colorGrading) without dropping siblings", () => {
    const base = createDefaultRecipe();
    base.colorGrading.shadows.lum = 0.4; // sibling of the patched hue/sat

    const merged = mergeRecipePatch(base, { colorGrading: { shadows: { hue: 210, sat: 0.3 } } });

    expect(merged.colorGrading.shadows.hue).toBe(210);
    expect(merged.colorGrading.shadows.sat).toBeCloseTo(0.3, 6);
    expect(merged.colorGrading.shadows.lum).toBeCloseTo(0.4, 6); // nested baseline preserved
  });

  it("replaces array-valued fields (tone-curve points) wholesale", () => {
    const base = createDefaultRecipe();
    const merged = mergeRecipePatch(base, { toneCurve: { point: [{ x: 0, y: 0.2 }, { x: 1, y: 0.8 }] } });
    expect(merged.toneCurve.point).toEqual([{ x: 0, y: 0.2 }, { x: 1, y: 0.8 }]);
  });

  it("leaves the recipe unchanged for an empty patch", () => {
    const base = createDefaultRecipe();
    base.basic.exposure = 0.42;
    expect(mergeRecipePatch(base, {}).basic.exposure).toBeCloseTo(0.42, 6);
  });
});
