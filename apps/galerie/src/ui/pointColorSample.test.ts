import { describe, expect, it } from "vitest";

import { rgbToHsl, sampleToSocket } from "./pointColorSample";

describe("rgbToHsl (mirrors engine color::rgb_to_hsl)", () => {
  it("pure primaries land on 0/120/240° at full saturation, mid luminance", () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 1, 0.5]);
    expect(rgbToHsl(0, 255, 0)[0]).toBeCloseTo(120);
    expect(rgbToHsl(0, 0, 255)[0]).toBeCloseTo(240);
  });

  it("neutral grey has zero saturation", () => {
    const [, s, l] = rgbToHsl(128, 128, 128);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(128 / 255);
  });
});

describe("sampleToSocket", () => {
  it("references the sampled colour with neutral adjustments + mid range", () => {
    const s = sampleToSocket(0, 255, 0);
    expect(s.srcHue).toBeCloseTo(120);
    expect(s.srcSat).toBeCloseTo(1);
    expect([s.hue, s.sat, s.lum]).toEqual([0, 0, 0]);
    expect(s.range).toBe(0.5);
  });
});
