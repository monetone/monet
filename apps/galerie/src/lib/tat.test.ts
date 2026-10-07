import { describe, expect, it } from "vitest";

import { bandForPixel, hueToBand, rgbToHue, tatBandValue } from "./tat";

describe("rgbToHue", () => {
  it("maps primaries and secondaries to canonical hues", () => {
    expect(rgbToHue(255, 0, 0)).toBeCloseTo(0, 5); // red
    expect(rgbToHue(255, 255, 0)).toBeCloseTo(60, 5); // yellow
    expect(rgbToHue(0, 255, 0)).toBeCloseTo(120, 5); // green
    expect(rgbToHue(0, 255, 255)).toBeCloseTo(180, 5); // cyan/aqua
    expect(rgbToHue(0, 0, 255)).toBeCloseTo(240, 5); // blue
    expect(rgbToHue(255, 0, 255)).toBeCloseTo(300, 5); // magenta
  });

  it("returns 0 for gray (achromatic)", () => {
    expect(rgbToHue(128, 128, 128)).toBe(0);
    expect(rgbToHue(0, 0, 0)).toBe(0);
    expect(rgbToHue(255, 255, 255)).toBe(0);
  });
});

describe("hueToBand", () => {
  it("snaps hues to the nearest of the 8 recipe bands", () => {
    expect(hueToBand(0)).toBe(0); // Red
    expect(hueToBand(30)).toBe(1); // Orange
    expect(hueToBand(60)).toBe(2); // Yellow
    expect(hueToBand(120)).toBe(3); // Green
    expect(hueToBand(180)).toBe(4); // Aqua
    expect(hueToBand(240)).toBe(5); // Blue
    expect(hueToBand(280)).toBe(6); // Purple
    expect(hueToBand(320)).toBe(7); // Magenta
  });

  it("wraps hue circularly toward the red band", () => {
    expect(hueToBand(359)).toBe(0); // just below 360 → nearest is Red (0)
    expect(hueToBand(-10)).toBe(0);
    expect(hueToBand(335)).toBe(7); // closer to Magenta (315) than Red (360)
  });
});

describe("bandForPixel", () => {
  it("routes a pure blue pixel to the Blue band", () => {
    expect(bandForPixel(0, 0, 255)).toBe(5);
  });
  it("routes a magenta pixel to the Magenta band", () => {
    expect(bandForPixel(255, 0, 255)).toBe(7);
  });
});

describe("tatBandValue", () => {
  it("dragging up raises the value, down lowers it", () => {
    expect(tatBandValue(0, 100)).toBeCloseTo(0.5, 10); // 100px up
    expect(tatBandValue(0, -100)).toBeCloseTo(-0.5, 10);
    expect(tatBandValue(0.2, 20)).toBeCloseTo(0.3, 10); // relative to start
  });
  it("clamps to the -1..1 band domain", () => {
    expect(tatBandValue(0.9, 100)).toBe(1);
    expect(tatBandValue(-0.9, -100)).toBe(-1);
  });
});
