// Unit tests for the Rounded Rectangle's pure outline geometry. Engine-free
// (node); the Shape-tool fill is covered by e2e/round-rect-shape.spec.ts.
import { describe, it, expect } from "vitest";
import { roundedRectVertices } from "./roundRectShape";

describe("roundedRectVertices", () => {
  it("returns the plain rectangle corners when radius is 0", () => {
    expect(roundedRectVertices(0, 0, 10, 8, 0)).toEqual([0, 0, 10, 0, 10, 8, 0, 8]);
  });

  it("returns 4 corner arcs of (seg+1) points for a positive radius", () => {
    expect(roundedRectVertices(0, 0, 40, 30, 5, 6).length).toBe(4 * 7 * 2); // 28 pts → 56 numbers
    expect(roundedRectVertices(0, 0, 40, 30, 5, 2).length).toBe(4 * 3 * 2); // seg=2 → 12 pts
  });

  it("clamps the radius to half the shorter side", () => {
    // 10×8 box → max radius 4; an over-large radius collapses to that
    expect(roundedRectVertices(0, 0, 10, 8, 1000)).toEqual(roundedRectVertices(0, 0, 10, 8, 4));
  });

  it("keeps every outline point inside the bounding box", () => {
    const v = roundedRectVertices(5, 7, 40, 24, 8);
    for (let i = 0; i < v.length / 2; i++) {
      const x = v[i * 2], y = v[i * 2 + 1];
      expect(x).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(x).toBeLessThanOrEqual(45 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(7 - 1e-6);
      expect(y).toBeLessThanOrEqual(31 + 1e-6);
    }
  });

  it("cuts the literal box corners (top-right corner is not a vertex)", () => {
    // first TR arc point sits r in from the right corner along the top edge
    const v = roundedRectVertices(0, 0, 40, 30, 8);
    expect(v[0]).toBeCloseTo(32, 6); // x0 + w - r = 40 - 8
    expect(v[1]).toBeCloseTo(0, 6);  // on the top edge
    // the literal corner (40,0) must not appear as a vertex
    const hasLiteralCorner = Array.from({ length: v.length / 2 }, (_, i) => i)
      .some((i) => Math.abs(v[i * 2] - 40) < 1e-6 && Math.abs(v[i * 2 + 1] - 0) < 1e-6);
    expect(hasLiteralCorner).toBe(false);
  });
});
