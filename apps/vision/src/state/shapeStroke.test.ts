// Unit tests for the shape stroke ring geometry. Engine-free (node); the canvas
// fill is covered by e2e/shape-stroke.spec.ts.
import { describe, it, expect } from "vitest";
import { strokeRingRects } from "./shapeStroke";

describe("strokeRingRects", () => {
  it("inside align keeps the outer at the shape bounds; inner inset by width", () => {
    expect(strokeRingRects(10, 20, 100, 80, 6, 0)).toEqual({
      outer: { x: 10, y: 20, w: 100, h: 80 },
      inner: { x: 16, y: 26, w: 88, h: 68 },
    });
  });

  it("centre align straddles the edge (grows by width/2)", () => {
    expect(strokeRingRects(10, 20, 100, 80, 6, 1)).toEqual({
      outer: { x: 7, y: 17, w: 106, h: 86 },
      inner: { x: 13, y: 23, w: 94, h: 74 },
    });
  });

  it("outside align grows by width; the inner edge is the shape rect", () => {
    expect(strokeRingRects(10, 20, 100, 80, 6, 2)).toEqual({
      outer: { x: 4, y: 14, w: 112, h: 92 },
      inner: { x: 10, y: 20, w: 100, h: 80 },
    });
  });

  it("yields a solid ring (inner w/h 0) when the stroke is wider than the shape", () => {
    const ring = strokeRingRects(10, 20, 100, 80, 60, 0)!;
    expect(ring.outer).toEqual({ x: 10, y: 20, w: 100, h: 80 });
    expect(ring.inner.w).toBe(0);
    expect(ring.inner.h).toBe(0);
  });

  it("returns null for a non-positive width", () => {
    expect(strokeRingRects(10, 20, 100, 80, 0, 1)).toBeNull();
    expect(strokeRingRects(10, 20, 100, 80, -4, 1)).toBeNull();
  });
});
