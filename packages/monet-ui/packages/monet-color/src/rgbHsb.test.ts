// Unit tests for the RGB→HSB converter. Engine-free (node); the Info-panel rows
// are covered by e2e/info-hsb.spec.ts.
import { describe, it, expect } from "vitest";
import { rgbToHsb } from "./rgbHsb";

describe("rgbToHsb", () => {
  it("maps the primaries to 0/120/240° at full saturation and brightness", () => {
    expect(rgbToHsb(255, 0, 0)).toEqual({ h: 0, s: 100, b: 100 });
    expect(rgbToHsb(0, 255, 0)).toEqual({ h: 120, s: 100, b: 100 });
    expect(rgbToHsb(0, 0, 255)).toEqual({ h: 240, s: 100, b: 100 });
  });

  it("maps a mixed hue (orange) to ~30°", () => {
    expect(rgbToHsb(255, 128, 0)).toEqual({ h: 30, s: 100, b: 100 });
  });

  it("wraps the magenta/red boundary into [0,360)", () => {
    // magenta: max=blue path with r>g → negative raw hue → +360 = 300°
    expect(rgbToHsb(255, 0, 255)).toEqual({ h: 300, s: 100, b: 100 });
  });

  it("wraps a hue that rounds up to 360° back to 0°", () => {
    // (255,0,1) raw hue ≈ 359.8° → rounds to 360 → wraps to 0 (Photoshop shows 0°)
    expect(rgbToHsb(255, 0, 1).h).toBe(0);
  });

  it("treats white/black/gray as achromatic", () => {
    expect(rgbToHsb(255, 255, 255)).toEqual({ h: 0, s: 0, b: 100 });
    expect(rgbToHsb(0, 0, 0)).toEqual({ h: 0, s: 0, b: 0 });
    expect(rgbToHsb(128, 128, 128)).toEqual({ h: 0, s: 0, b: 50 });
  });
});
