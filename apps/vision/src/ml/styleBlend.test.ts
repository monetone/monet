import { describe, expect, it } from "vitest";
import { blendStyle } from "./styleBlend";

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

describe("blendStyle", () => {
  it("leaves the stylized pixels untouched at full strength with no colour preservation", () => {
    const styled = px(10, 200, 30);
    expect(Array.from(blendStyle(styled, px(90, 90, 90)))).toEqual([10, 200, 30, 255]);
  });

  it("returns the original at zero strength", () => {
    expect(Array.from(blendStyle(px(10, 200, 30), px(90, 91, 92), { strength: 0 }))).toEqual([90, 91, 92, 255]);
  });

  it("lerps halfway at 50% strength", () => {
    expect(Array.from(blendStyle(px(0, 0, 0), px(100, 200, 40), { strength: 0.5 }))).toEqual([50, 100, 20, 255]);
  });

  it("preserve colour keeps the original hue and takes the stylized luminance", () => {
    // Original is saturated red, style output is a mid grey brighter than it.
    const original = px(200, 0, 0);
    const out = blendStyle(px(180, 180, 180), original, { preserveColor: 1 });
    // Red still dominates (hue kept) and every channel rose by the luma delta.
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBe(out[2]);
    expect(out[1]).toBeGreaterThan(0);
  });

  it("preserve colour is a no-op when style and original share a luminance", () => {
    const grey = px(128, 128, 128);
    expect(Array.from(blendStyle(px(128, 128, 128), grey, { preserveColor: 1 }))).toEqual([128, 128, 128, 255]);
  });

  it("clamps out-of-range knobs instead of producing garbage", () => {
    expect(Array.from(blendStyle(px(10, 20, 30), px(200, 200, 200), { strength: 5 }))).toEqual([10, 20, 30, 255]);
    expect(Array.from(blendStyle(px(10, 20, 30), px(200, 200, 200), { strength: -1 }))).toEqual([200, 200, 200, 255]);
  });

  it("never touches alpha and handles multi-pixel buffers", () => {
    const styled = new Uint8ClampedArray([0, 0, 0, 12, 255, 255, 255, 34]);
    const out = blendStyle(styled, new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]), { strength: 0.5 });
    expect(Array.from(out)).toEqual([50, 50, 50, 12, 178, 178, 178, 34]);
  });
});
