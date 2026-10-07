// V5 advanced tail (#444): the Detail sub-sliders, lens Vignetting, the Defringe
// hue windows + green amount and the Upright mode ride a trailing 12-float block
// after the V4 transform block, in BOTH tail dialects. Recipes that leave them at
// their defaults keep their exact prior bytes, and every emitted value sits inside
// the engine parser's ranges so a hostile recipe can never reject the whole tail.

import { describe, expect, it } from "vitest";

import { createDefaultRecipe, type DevelopRecipeV2 } from "./developRecipe";
import { recipeToParams, UPRIGHT_CODES } from "./developParams";

/** Slot of each extra counted from the END of the params (the block is last). */
const FROM_END = {
  sharpenDetail: 12, sharpenMasking: 11, nrLuminanceContrast: 10, nrColorDetail: 9,
  nrColorSmoothness: 8, vignettingAmount: 7, purpleLo: 6, purpleHi: 5,
  defringeGreenAmount: 4, greenLo: 3, greenHi: 2, upright: 1,
} as const;

const last = (p: Float32Array, n: number) => p[p.length - n];

describe.each(["auto", "visionV2"] as const)("V5 extras tail (%s dialect)", (tailFormat) => {
  const params = (r: DevelopRecipeV2) => recipeToParams(r, 1, { tailFormat });

  it("keeps the default recipe at 1086 floats", () => {
    expect(params(createDefaultRecipe()).length).toBe(1086);
  });

  it("keeps a point-color-only recipe on version 3", () => {
    const r = createDefaultRecipe();
    r.pointColor.samples.push({ srcHue: 120, srcSat: 0.5, srcLum: 0.5, hue: 0.1, sat: 0, lum: 0, range: 0.5 });
    expect(params(r)[1087]).toBe(3);
  });

  it.each<[keyof typeof FROM_END, (r: DevelopRecipeV2) => void, number]>([
    ["sharpenDetail", (r) => { r.detail.sharpenDetail = 60; }, 60],
    ["sharpenMasking", (r) => { r.detail.sharpenMasking = 35; }, 35],
    ["nrLuminanceContrast", (r) => { r.detail.nrLuminanceContrast = 40; }, 40],
    ["nrColorDetail", (r) => { r.detail.nrColorDetail = 10; }, 10],
    ["nrColorSmoothness", (r) => { r.detail.nrColorSmoothness = 90; }, 90],
    ["vignettingAmount", (r) => { r.optics.vignettingAmount = -0.5; }, -0.5],
    ["purpleLo", (r) => { r.optics.defringePurpleHue = [20, 70]; }, 20],
    ["purpleHi", (r) => { r.optics.defringePurpleHue = [30, 90]; }, 90],
    ["defringeGreenAmount", (r) => { r.optics.defringeGreenAmount = 0.25; }, 0.25],
    ["greenLo", (r) => { r.optics.defringeGreenHue = [25, 60]; }, 25],
    ["greenHi", (r) => { r.optics.defringeGreenHue = [40, 75]; }, 75],
    ["upright", (r) => { r.transform.upright = "level"; }, UPRIGHT_CODES.level],
  ])("%s off its default emits v5 with the value in its slot", (slot, edit, value) => {
    const r = createDefaultRecipe();
    edit(r);
    const p = params(r);
    expect(p[1086]).toBe(22026);
    expect(p[1087]).toBe(5);
    expect(last(p, FROM_END[slot])).toBeCloseTo(value, 5);
    // The v4 transform block (neutral here) and a zero socket count precede it.
    expect(Array.from(p.slice(p.length - 17, p.length - 12))).toEqual([0, 1, 0, 0, 0]);
    expect(last(p, 18)).toBe(0);
  });

  it("emits v4 for a transform extra alone: socket count 0, then the transform block", () => {
    const r = createDefaultRecipe();
    r.transform.scale = 1.2;
    const p = params(r);
    expect(p[1087]).toBe(4);
    expect(last(p, 6)).toBe(0);
    expect(last(p, 4)).toBeCloseTo(1.2, 5);
  });

  it("pre-clamps hostile extras into the engine parser's ranges", () => {
    const r = createDefaultRecipe();
    r.detail.sharpenDetail = 500;
    r.detail.nrColorSmoothness = -20;
    r.optics.vignettingAmount = -3;
    r.optics.defringePurpleHue = [80, 20];
    r.optics.defringeGreenHue = [40, 300];
    r.optics.defringeGreenAmount = 7;
    (r.transform as { upright: string }).upright = "junk";
    const p = params(r);
    expect(p[1087]).toBe(5);
    expect(last(p, FROM_END.sharpenDetail)).toBe(100);
    expect(last(p, FROM_END.nrColorSmoothness)).toBe(0);
    expect(last(p, FROM_END.vignettingAmount)).toBe(-1);
    expect([last(p, FROM_END.purpleLo), last(p, FROM_END.purpleHi)]).toEqual([20, 80]);
    expect([last(p, FROM_END.greenLo), last(p, FROM_END.greenHi)]).toEqual([40, 100]);
    expect(last(p, FROM_END.defringeGreenAmount)).toBe(1);
    expect(last(p, FROM_END.upright)).toBe(0);
  });

  it("a disabled panel contributes no extras", () => {
    const r = createDefaultRecipe();
    r.detail.sharpenDetail = 60;
    r.enabled.detail = false;
    expect(params(r).length).toBe(1086);
  });
});

it("numbers the Upright modes in ACR's button order", () => {
  expect(UPRIGHT_CODES).toEqual({ off: 0, auto: 1, level: 2, vertical: 3, full: 4, guided: 5 });
});
