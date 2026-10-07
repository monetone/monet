import { describe, expect, it } from "vitest";

import { insertPoint, movePoint, nearestPoint, removePoint } from "./toneCurveEdit";

const identity = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

describe("nearestPoint", () => {
  it("hits a point within tolerance and misses outside it", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(nearestPoint(pts, 0.51, 0.49, 0.05)).toBe(1);
    expect(nearestPoint(pts, 0.5, 0.9, 0.05)).toBe(-1);
  });

  it("returns the closest when several are near", () => {
    const pts = [{ x: 0.4, y: 0.4 }, { x: 0.45, y: 0.45 }];
    expect(nearestPoint(pts, 0.44, 0.44, 0.1)).toBe(1);
  });
});

describe("insertPoint", () => {
  it("inserts sorted and reports the new index; clamps to the unit square", () => {
    const { points, index } = insertPoint(identity(), 1.2, -0.3);
    expect(points.map((p) => p.x)).toEqual([0, 1, 1]); // 1.2 clamped to 1
    expect(points[index]).toEqual({ x: 1, y: 0 });
  });

  it("keeps points ordered by x", () => {
    const { points } = insertPoint(identity(), 0.5, 0.7);
    expect(points).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }]);
  });
});

describe("movePoint", () => {
  it("moves an endpoint vertically only (x fixed)", () => {
    const moved = movePoint(identity(), 0, 0.4, 0.6);
    expect(moved[0]).toEqual({ x: 0, y: 0.6 }); // x stayed 0
  });

  it("clamps an interior point strictly between its neighbours", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    // Drag the middle point past the right endpoint → clamped just below x=1.
    const moved = movePoint(pts, 1, 2, 0.5);
    expect(moved[1].x).toBeLessThan(1);
    expect(moved[1].x).toBeGreaterThan(0.5 - 1); // sanity
    expect(moved[1].x).toBeCloseTo(1 - 1e-3, 6);
  });

  it("clamps y into [0,1]", () => {
    const moved = movePoint(identity(), 1, 1, 5);
    expect(moved[1].y).toBe(1);
  });

  it("is a no-op for an out-of-range index", () => {
    expect(movePoint(identity(), 9, 0.5, 0.5)).toEqual(identity());
  });
});

describe("removePoint", () => {
  it("removes an interior point", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(removePoint(pts, 1)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it("never removes an endpoint", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(removePoint(pts, 0)).toEqual(pts);
    expect(removePoint(pts, 2)).toEqual(pts);
  });
});
