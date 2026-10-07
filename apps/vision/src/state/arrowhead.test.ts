// Unit tests for the Line arrowhead geometry. Engine-free (node); the options-bar
// + canvas fill are covered by e2e/line-arrowhead.spec.ts.
import { describe, it, expect } from "vitest";
import { arrowheadPolygon } from "./arrowhead";

describe("arrowheadPolygon", () => {
  it("builds a rightward arrowhead from absolute pixel dimensions", () => {
    const p = arrowheadPolygon(160, 80, 1, 0, 20, 40, 0);
    expect(p).toEqual([160, 80, 120, 90, 120, 80, 120, 70]);
  });

  it("points the arrowhead along an upward direction", () => {
    // dir (0,-1) (up, y-down screen): base is L below the tip
    const p = arrowheadPolygon(80, 40, 0, -1, 20, 40, 0);
    // tip
    expect([p[0], p[1]]).toEqual([80, 40]);
    // base centre is 40 below (y 80); base corners ±10 in x
    expect([p[4], p[5]]).toEqual([80, 80]); // mid-back at base centre
    expect([p[2], p[6]].map((v) => Math.round(v)).sort((a, b) => a - b)).toEqual([70, 90]); // base corners at x 70/90
    expect([p[3], p[7]]).toEqual([80, 80]); // both base corners at y 80
  });

  it("moves the mid-back toward the tip for positive concavity, away for negative", () => {
    const pos = arrowheadPolygon(160, 80, 1, 0, 20, 40, 50); // +50% → mid-back +20 toward tip
    expect(pos[4]).toBeCloseTo(140, 5); // 120 + 0.5*40
    const neg = arrowheadPolygon(160, 80, 1, 0, 20, 40, -50);
    expect(neg[4]).toBeCloseTo(100, 5); // 120 - 0.5*40
  });

  it("normalizes a non-unit direction vector", () => {
    // dir (2,0) should behave like (1,0)
    expect(arrowheadPolygon(160, 80, 2, 0, 20, 40, 0)).toEqual([160, 80, 120, 90, 120, 80, 120, 70]);
  });

  it("returns [] for a zero-length direction", () => {
    expect(arrowheadPolygon(160, 80, 0, 0, 20, 40, 0)).toEqual([]);
  });
});
