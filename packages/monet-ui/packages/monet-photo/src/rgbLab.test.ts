// Unit tests for the sRGB↔Lab conversion. Engine-free (node); the Info-panel rows
// are covered by e2e/info-lab.spec.ts.
import { describe, it, expect } from "vitest";
import { labToRgb, rgbToLab } from "./rgbLab";

describe("rgbToLab", () => {
  it("maps white and black to the lightness extremes with neutral a/b", () => {
    expect(rgbToLab(255, 255, 255)).toEqual({ l: 100, a: 0, b: 0 });
    expect(rgbToLab(0, 0, 0)).toEqual({ l: 0, a: 0, b: 0 });
  });

  it("keeps neutral greys at a=0,b=0", () => {
    expect(rgbToLab(128, 128, 128)).toEqual({ l: 54, a: 0, b: 0 });
  });

  it("reads the sRGB primaries as Photoshop's D50 Lab does", () => {
    expect(rgbToLab(255, 0, 0)).toEqual({ l: 54, a: 81, b: 70 });
    expect(rgbToLab(0, 255, 0)).toEqual({ l: 88, a: -79, b: 81 });
    expect(rgbToLab(0, 0, 255)).toEqual({ l: 30, a: 68, b: -112 });
  });
});

describe("labToRgb", () => {
  it("inverts rgbToLab and keeps neutrals neutral", () => {
    const [r, g, b] = labToRgb(29.57, 68.3, -112.05); // sRGB blue
    expect([Math.round(r), Math.round(g), Math.round(b)]).toEqual([0, 0, 255]);
    const gray = labToRgb(50, 0, 0);
    expect(Math.abs(gray[0] - gray[1]) < 0.01 && Math.abs(gray[1] - gray[2]) < 0.01).toBe(true);
  });
});
