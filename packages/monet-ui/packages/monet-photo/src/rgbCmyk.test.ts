// Unit tests for the naive sRGB→CMYK conversion. Engine-free (node); the Info-panel
// rows are covered by e2e/info-cmyk.spec.ts.
import { describe, it, expect } from "vitest";
import { rgbToCmyk } from "./rgbCmyk";

describe("rgbToCmyk", () => {
  it("maps white to no ink and black to full K", () => {
    expect(rgbToCmyk(255, 255, 255)).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    expect(rgbToCmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it("maps a neutral grey to K only", () => {
    expect(rgbToCmyk(128, 128, 128)).toEqual({ c: 0, m: 0, y: 0, k: 50 });
  });

  it("maps the red primary and an orange mix", () => {
    expect(rgbToCmyk(255, 0, 0)).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(rgbToCmyk(255, 128, 0)).toEqual({ c: 0, m: 50, y: 100, k: 0 });
  });
});
