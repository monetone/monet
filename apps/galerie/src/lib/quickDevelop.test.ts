import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "@monet-ui/monet-photo";

import { QUICK_SPECS, quickReset, quickStep } from "./quickDevelop";

describe("quickStep", () => {
  it("applies a small relative step in the scaled domain", () => {
    const recipe = createDefaultRecipe();
    const next = quickStep(recipe, "contrast", 1, false);
    expect(next.basic.contrast).toBeCloseTo(0.05, 10); // +5 int × 0.01
    expect(recipe.basic.contrast).toBe(0); // input untouched
  });

  it("big exposure step is exactly 1 EV in stored units", () => {
    const next = quickStep(createDefaultRecipe(), "exposure", 1, true);
    expect(next.basic.exposure).toBeCloseTo(1.0, 10); // 25 int × 0.04
  });

  it("steps are relative to the existing value", () => {
    const recipe = createDefaultRecipe();
    recipe.basic.shadows = 0.4; // int 40
    const next = quickStep(recipe, "shadows", -1, true);
    expect(next.basic.shadows).toBeCloseTo(0.2, 10); // 40 − 20 = 20 int
  });

  it("clamps at the ±100 int domain bounds", () => {
    const recipe = createDefaultRecipe();
    recipe.basic.vibrance = 0.95; // int 95
    expect(quickStep(recipe, "vibrance", 1, true).basic.vibrance).toBeCloseTo(1.0, 10);
    recipe.basic.vibrance = -0.95;
    expect(quickStep(recipe, "vibrance", -1, true).basic.vibrance).toBeCloseTo(-1.0, 10);
  });

  it("does not touch unrelated fields or panels", () => {
    const recipe = createDefaultRecipe();
    recipe.basic.texture = 0.3;
    const next = quickStep(recipe, "clarity", 1, false);
    expect(next.basic.texture).toBe(0.3);
    expect(next.detail).toEqual(recipe.detail);
  });
});

describe("quickReset", () => {
  it("zeroes every quick-controlled field and keeps the rest", () => {
    const recipe = createDefaultRecipe();
    for (const spec of QUICK_SPECS) recipe.basic[spec.key] = 0.5;
    recipe.basic.texture = 0.25;
    recipe.basic.dehaze = -0.25;
    const next = quickReset(recipe);
    for (const spec of QUICK_SPECS) expect(next.basic[spec.key]).toBe(0);
    expect(next.basic.texture).toBe(0.25); // not a Quick Develop row
    expect(next.basic.dehaze).toBe(-0.25);
  });
});
