// Unit tests for the vectorscope display geometry. Engine-free (node); the
// n×n density grid itself is produced + tested in packages/engine
// (vectorscope_tests), and the panel toggle is covered by
// e2e/vectorscope.spec.ts. Here we only pin the pure display math.
import { describe, it, expect } from "vitest";
import { rgbToScope, vectorscopeTargets, skinToneLine, cellHue } from "./vectorscope";

describe("rgbToScope", () => {
  it("maps a neutral gray to the exact centre", () => {
    const { fx, fy } = rgbToScope(0.5, 0.5, 0.5);
    expect(fx).toBeCloseTo(0.5, 6);
    expect(fy).toBeCloseTo(0.5, 6);
  });

  it("plots bright red in the upper half (fy < 0.5) and off-centre", () => {
    const { fx, fy } = rgbToScope(1, 0, 0);
    expect(fy).toBeLessThan(0.5); // positive R-Y → above centre
    expect(fx).not.toBeCloseTo(0.5, 2);
  });

  it("places complementary colours on opposite sides through the centre", () => {
    const red = rgbToScope(0.75, 0, 0);
    const cyan = rgbToScope(0, 0.75, 0.75);
    // opposite sign of the centre offset on both axes
    expect(Math.sign(red.fx - 0.5)).toBe(-Math.sign(cyan.fx - 0.5));
    expect(Math.sign(red.fy - 0.5)).toBe(-Math.sign(cyan.fy - 0.5));
  });
});

describe("vectorscopeTargets", () => {
  it("returns the six labelled hue targets inside the unit square", () => {
    const t = vectorscopeTargets();
    expect(t.map((x) => x.label)).toEqual(["R", "Yl", "G", "Cy", "B", "Mg"]);
    for (const { fx, fy } of t) {
      expect(fx).toBeGreaterThanOrEqual(0);
      expect(fx).toBeLessThanOrEqual(1);
      expect(fy).toBeGreaterThanOrEqual(0);
      expect(fy).toBeLessThanOrEqual(1);
    }
  });
});

describe("skinToneLine", () => {
  it("runs from centre toward the orange (R–Yl) quadrant", () => {
    const { cx, cy, ex, ey } = skinToneLine();
    expect(cx).toBe(0.5);
    expect(cy).toBe(0.5);
    // warm skin ⇒ reddish-yellow ⇒ above-and-left of centre in scope space
    expect(ey).toBeLessThan(0.5);
    expect(ex).toBeLessThan(0.5);
  });
});

describe("cellHue", () => {
  it("reports a red-ish hue for a cell in the red region", () => {
    const { fx, fy } = rgbToScope(1, 0, 0);
    const h = cellHue(fx, fy);
    expect(h < 30 || h > 330).toBe(true); // near 0°/360° = red
  });

  it("reports a blue-ish hue for a cell in the blue region", () => {
    const { fx, fy } = rgbToScope(0, 0, 1);
    const h = cellHue(fx, fy);
    expect(h).toBeGreaterThan(180);
    expect(h).toBeLessThan(300); // blue ≈ 240°
  });
});
