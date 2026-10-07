// Panel enable switches (GAL-DEV-12): recipe.enabled.* gates a panel's whole
// contribution at serialize time — a disabled panel is substituted with its
// neutral default in ONE place (applyPanelEnables) so every tail format is
// covered. toneCurve keeps the dedicated engine float p[25] (Vision semantics:
// authored points survive a disabled curve).

import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "./developRecipe";
import { recipeToParams } from "./developParams";

describe("per-panel enable gating in recipeToParams", () => {
  it("all-enabled recipe serializes values verbatim", () => {
    const r = createDefaultRecipe();
    r.basic.exposure = 0.5;
    r.detail.sharpenAmount = 0.4;
    const p = recipeToParams(r);
    expect(p[4]).toBeCloseTo(0.5, 5);
    expect(p[15]).toBeCloseTo(0.4, 5);
  });

  it("disabled basic zeroes the basic block [2..14]", () => {
    const r = createDefaultRecipe();
    r.basic.exposure = 1.2;
    r.basic.saturation = -0.5;
    r.enabled.basic = false;
    const p = recipeToParams(r);
    expect(p[4]).toBe(0);
    expect(p[14]).toBe(0);
  });

  it("disabled detail neutralizes sharpening/NR (radius back to 1)", () => {
    const r = createDefaultRecipe();
    r.detail.sharpenAmount = 0.8;
    r.detail.sharpenRadius = 2.5;
    r.detail.nrLuminance = 0.6;
    r.enabled.detail = false;
    const p = recipeToParams(r);
    expect(p[15]).toBe(0);
    expect(p[16]).toBe(1); // engine-neutral radius, not 0
    expect(p[17]).toBe(0);
  });

  it("disabled effects neutralizes grain + vignette (midpoint back to 0.5)", () => {
    const r = createDefaultRecipe();
    r.effects.grainAmount = 0.7;
    r.effects.vignetteAmount = -0.9;
    r.effects.vignetteMidpoint = 0.1;
    r.enabled.effects = false;
    const p = recipeToParams(r);
    expect(p[20]).toBe(0);
    expect(p[23]).toBe(0);
    expect(p[24]).toBe(0.5);
  });

  it("disabled optics zeroes distortion/CA/defringe", () => {
    const r = createDefaultRecipe();
    r.optics.distortionAmount = -0.4;
    r.optics.aberration = 1;
    r.optics.defringePurpleAmount = 0.3;
    r.enabled.optics = false;
    const p = recipeToParams(r);
    expect(p[1050]).toBe(0);
    expect(p[1051]).toBe(0);
    expect(p[1052]).toBe(0);
  });

  it("disabled colorMixer zeroes the 24 HSL bands", () => {
    const r = createDefaultRecipe();
    r.colorMixer.hue[0] = 0.5;
    r.colorMixer.luminance[7] = -0.5;
    r.enabled.colorMixer = false;
    const p = recipeToParams(r);
    for (let i = 0; i < 24; i++) expect(p[1053 + i]).toBe(0);
  });

  it("disabled colorGrading zeroes the six wheel floats", () => {
    const r = createDefaultRecipe();
    r.colorGrading.shadows.hue = 220;
    r.colorGrading.highlights.sat = 0.8;
    r.enabled.colorGrading = false;
    const p = recipeToParams(r);
    for (let i = 0; i < 6; i++) expect(p[1077 + i]).toBe(0);
  });

  it("disabled transform drops keystone AND the v4 tail (back to 1086)", () => {
    const r = createDefaultRecipe();
    r.transform.vertical = 0.3;
    r.transform.scale = 1.5; // would force a v4 tail when enabled
    r.enabled.transform = false;
    const p = recipeToParams(r);
    expect(p.length).toBe(1086);
    expect(p[1083]).toBe(0);
  });

  it("disabled calibration suppresses the advanced tail it would force", () => {
    const r = createDefaultRecipe();
    r.calibration.redHue = 0.4;
    r.enabled.calibration = false;
    expect(recipeToParams(r).length).toBe(1086);
  });

  it("disabled pointColor suppresses the v3 socket tail", () => {
    const r = createDefaultRecipe();
    r.pointColor.samples.push({ srcHue: 120, srcSat: 0.5, srcLum: 0.5, hue: 0.1, sat: 0, lum: 0, range: 0.5 });
    r.enabled.pointColor = false;
    expect(recipeToParams(r).length).toBe(1086);
  });

  it("disabled toneCurve keeps authored LUTs but clears the enable float p[25]", () => {
    const r = createDefaultRecipe();
    r.toneCurve.point = [
      { x: 0, y: 0.2 },
      { x: 1, y: 1 },
    ];
    r.enabled.toneCurve = false;
    const p = recipeToParams(r);
    expect(p[25]).toBe(0);
    expect(p[26]).toBeCloseTo(0.2 * 255, 3); // master LUT still carries the curve
  });

  it("re-enabling restores the authored values untouched (switch is non-destructive)", () => {
    const r = createDefaultRecipe();
    r.detail.sharpenAmount = 0.8;
    r.enabled.detail = false;
    recipeToParams(r);
    r.enabled.detail = true;
    expect(recipeToParams(r)[15]).toBeCloseTo(0.8, 5);
  });
});
