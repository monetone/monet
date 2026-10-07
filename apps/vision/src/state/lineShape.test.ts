// Unit tests for the Line shape's pure quad geometry. Engine-free (node); the
// Shape-tool fill is covered by e2e/line-shape.spec.ts.
import { describe, it, expect } from "vitest";
import { lineQuad } from "./lineShape";

describe("lineQuad", () => {
  it("builds a centred quad for a horizontal line", () => {
    // (0,0)→(10,0) weight 4 → a 10×4 band straddling y=0
    expect(lineQuad(0, 0, 10, 0, 4)).toEqual([0, 2, 10, 2, 10, -2, 0, -2]);
  });

  it("builds a centred quad for a vertical line", () => {
    // (0,0)→(0,10) weight 4 → a 4×10 band straddling x=0
    expect(lineQuad(0, 0, 0, 10, 4)).toEqual([-2, 0, -2, 10, 2, 10, 2, 0]);
  });

  it("keeps the quad perpendicular and weight-wide for a diagonal", () => {
    const q = lineQuad(0, 0, 10, 10, Math.SQRT2 * 2); // hw = √2, normal (−1,1)·…
    // corner0 = (0,0) + normal*hw; normal = (-dy,dx)/len = (-1,1)/√2; *hw(√2) = (-1,1)
    expect(q[0]).toBeCloseTo(-1, 6);
    expect(q[1]).toBeCloseTo(1, 6);
    // opposite side corner3 = (0,0) - (-1,1) = (1,-1)
    expect(q[6]).toBeCloseTo(1, 6);
    expect(q[7]).toBeCloseTo(-1, 6);
  });

  it("clamps weight to a minimum of 1px", () => {
    // weight 0 → hw 0.5 → offsets ±0.5
    expect(lineQuad(0, 0, 10, 0, 0)).toEqual([0, 0.5, 10, 0.5, 10, -0.5, 0, -0.5]);
  });

  it("returns [] for a zero-length segment", () => {
    expect(lineQuad(5, 5, 5, 5, 3)).toEqual([]);
  });
});
