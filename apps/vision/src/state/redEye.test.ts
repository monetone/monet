import { describe, it, expect } from "vitest";
import { clampUnit, redEyeArgs, REDEYE_PUPIL_DEFAULT, REDEYE_DARKEN_DEFAULT } from "./redEye";

describe("clampUnit", () => {
  it("passes values within 0..1 through", () => {
    expect(clampUnit(0.5)).toBe(0.5);
    expect(clampUnit(0)).toBe(0);
    expect(clampUnit(1)).toBe(1);
  });
  it("clamps out-of-range values", () => {
    expect(clampUnit(-0.3)).toBe(0);
    expect(clampUnit(1.7)).toBe(1);
  });
  it("treats non-finite values as 0", () => {
    expect(clampUnit(NaN)).toBe(0);
    expect(clampUnit(Infinity)).toBe(1); // Infinity clamps to the max, not NaN
    expect(clampUnit(-Infinity)).toBe(0);
  });
});

describe("redEyeArgs", () => {
  it("maps the 50%/50% defaults to 128/128", () => {
    expect(REDEYE_PUPIL_DEFAULT).toBe(0.5);
    expect(REDEYE_DARKEN_DEFAULT).toBe(0.5);
    expect(redEyeArgs(REDEYE_PUPIL_DEFAULT, REDEYE_DARKEN_DEFAULT)).toEqual({ pupil: 128, darken: 128 });
  });
  it("maps the extremes to 0 and 255", () => {
    expect(redEyeArgs(0, 0)).toEqual({ pupil: 0, darken: 0 });
    expect(redEyeArgs(1, 1)).toEqual({ pupil: 255, darken: 255 });
  });
  it("clamps and rounds out-of-range / fractional inputs", () => {
    expect(redEyeArgs(2, -1)).toEqual({ pupil: 255, darken: 0 });
    expect(redEyeArgs(0.25, 0.75)).toEqual({ pupil: 64, darken: 191 });
  });
});
