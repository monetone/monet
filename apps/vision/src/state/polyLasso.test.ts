// Unit tests for the Polygonal Lasso's pure helpers. Engine-free (node); the
// click-to-build / close interaction is covered by e2e/poly-lasso.spec.ts.
import { describe, it, expect } from "vitest";
import { nearPoint, canClose, polygonArrays, MIN_LASSO_POINTS } from "./polyLasso";

describe("nearPoint", () => {
  it("is true within the tolerance and false beyond it", () => {
    expect(nearPoint(0, 0, 3, 4, 5)).toBe(true); // distance 5 == tol
    expect(nearPoint(0, 0, 3, 4, 4)).toBe(false); // distance 5 > tol
    expect(nearPoint(20, 20, 20, 20, 0)).toBe(true); // exact start point
  });
});

describe("canClose", () => {
  it("requires at least a triangle (>= 3 vertices)", () => {
    expect(MIN_LASSO_POINTS).toBe(3);
    expect(canClose([0, 0, 10, 0])).toBe(false); // 2 vertices
    expect(canClose([0, 0, 10, 0, 5, 8])).toBe(true); // 3 vertices
  });
});

describe("polygonArrays", () => {
  it("de-interleaves a flat [x,y,...] list into xs/ys", () => {
    const { xs, ys } = polygonArrays([0, 0, 10, 0, 5, 8]);
    expect(Array.from(xs)).toEqual([0, 10, 5]);
    expect(Array.from(ys)).toEqual([0, 0, 8]);
  });
});
