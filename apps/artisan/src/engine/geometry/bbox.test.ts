// ─────────────────────────────────────────────────────────────
// bbox.test — axis-aligned bounding rectangles
// ─────────────────────────────────────────────────────────────
// Completes the geometry coverage (matrix + bezier already tested). bbox is the
// rect algebra behind selection bounds, hit-testing and AABBs. Pins the corner
// conventions, the half-open intersection vs inclusive containment split, the
// null-handling in union/unionAll, and transform = AABB of transformed corners.

import { describe, it, expect } from "vitest";
import { pt } from "./vec";
import { IDENTITY, matrix, scaling, translation } from "./matrix";
import {
  EMPTY,
  area,
  bottom,
  center,
  centerX,
  centerY,
  containsPoint,
  containsRect,
  corners,
  fromCenter,
  fromPoints,
  fromTwoPoints,
  inflate,
  intersection,
  intersects,
  isEmpty,
  left,
  rect,
  right,
  top,
  transform,
  union,
  unionAll,
} from "./bbox";

describe("accessors", () => {
  const r = rect(10, 20, 30, 40);
  it("edges, centre and area", () => {
    expect([left(r), top(r), right(r), bottom(r)]).toEqual([10, 20, 40, 60]);
    expect([centerX(r), centerY(r)]).toEqual([25, 40]);
    expect(center(r)).toEqual({ x: 25, y: 40 });
    expect(area(r)).toBe(1200);
  });
  it("isEmpty when either dimension is non-positive", () => {
    expect(isEmpty(rect(0, 0, 5, 5))).toBe(false);
    expect(isEmpty(rect(0, 0, 0, 5))).toBe(true);
    expect(isEmpty(rect(0, 0, 5, -1))).toBe(true);
  });
});

describe("constructors", () => {
  it("fromPoints spans the extent; empty input is a fresh EMPTY copy", () => {
    expect(fromPoints([pt(3, 7), pt(-1, 2), pt(5, 5)])).toEqual({ x: -1, y: 2, width: 6, height: 5 });
    expect(fromPoints([pt(4, 9)])).toEqual({ x: 4, y: 9, width: 0, height: 0 }); // degenerate
    const empty = fromPoints([]);
    expect(empty).toEqual(EMPTY);
    expect(empty).not.toBe(EMPTY); // a copy, so callers can't mutate the shared EMPTY
  });

  it("fromTwoPoints normalises to a min corner + positive size", () => {
    expect(fromTwoPoints(pt(10, 10), pt(4, 40))).toEqual({ x: 4, y: 10, width: 6, height: 30 });
  });

  it("fromCenter places a rect around its centre", () => {
    expect(fromCenter(50, 50, 20, 10)).toEqual({ x: 40, y: 45, width: 20, height: 10 });
  });

  it("corners walk clockwise from the top-left", () => {
    expect(corners(rect(0, 0, 10, 20))).toEqual([pt(0, 0), pt(10, 0), pt(10, 20), pt(0, 20)]);
  });
});

describe("union", () => {
  it("bounds both rects", () => {
    expect(union(rect(0, 0, 10, 10), rect(20, 20, 10, 10))).toEqual({ x: 0, y: 0, width: 30, height: 30 });
  });
  it("treats null as absent and returns copies, never the input", () => {
    const b = rect(1, 2, 3, 4);
    const u = union(null, b);
    expect(u).toEqual(b);
    expect(u).not.toBe(b);
    expect(union(null, null)).toEqual(EMPTY);
  });
  it("unionAll folds a list, with null for the empty case", () => {
    expect(unionAll([])).toBeNull();
    expect(unionAll([rect(0, 0, 5, 5), rect(10, 10, 5, 5)])).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  });
});

describe("intersection vs intersects (half-open)", () => {
  it("intersection returns the overlap, or null when none / edge-touching", () => {
    expect(intersection(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(intersection(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBeNull(); // share an edge → no area
    expect(intersection(rect(0, 0, 10, 10), rect(20, 20, 5, 5))).toBeNull(); // disjoint
  });
  it("intersects is true only for positive-area overlap", () => {
    expect(intersects(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(intersects(rect(0, 0, 10, 10), rect(10, 0, 5, 5))).toBe(false); // touching edge
    expect(intersects(rect(0, 0, 10, 10), rect(20, 0, 5, 5))).toBe(false); // disjoint
  });
});

describe("containment (inclusive)", () => {
  const r = rect(0, 0, 10, 10);
  it("containsPoint includes the boundary", () => {
    expect(containsPoint(r, pt(5, 5))).toBe(true);
    expect(containsPoint(r, pt(0, 0))).toBe(true); // corner
    expect(containsPoint(r, pt(10, 10))).toBe(true); // far corner
    expect(containsPoint(r, pt(11, 5))).toBe(false);
    expect(containsPoint(r, pt(-1, 5))).toBe(false);
  });
  it("containsRect is inclusive and rejects anything poking outside", () => {
    expect(containsRect(r, rect(2, 2, 5, 5))).toBe(true);
    expect(containsRect(r, rect(0, 0, 10, 10))).toBe(true); // equal rects
    expect(containsRect(r, rect(2, 2, 9, 9))).toBe(false); // 2+9 > 10
  });
});

describe("inflate", () => {
  it("grows symmetrically; dy defaults to dx; negative deflates", () => {
    expect(inflate(rect(10, 10, 20, 20), 5)).toEqual({ x: 5, y: 5, width: 30, height: 30 });
    expect(inflate(rect(10, 10, 20, 20), 5, 2)).toEqual({ x: 5, y: 8, width: 30, height: 24 });
    expect(inflate(rect(0, 0, 10, 10), -2)).toEqual({ x: 2, y: 2, width: 6, height: 6 });
  });
});

describe("transform = AABB of transformed corners", () => {
  it("identity is a no-op", () => {
    expect(transform(rect(1, 2, 3, 4), IDENTITY)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
  it("translation shifts the box", () => {
    expect(transform(rect(0, 0, 10, 10), translation(10, 20))).toEqual({ x: 10, y: 20, width: 10, height: 10 });
  });
  it("scaling grows the box about the origin", () => {
    expect(transform(rect(1, 1, 2, 2), scaling(2))).toEqual({ x: 2, y: 2, width: 4, height: 4 });
  });
  it("a 90° rotation re-bounds to the rotated AABB", () => {
    // exact 90° matrix (x,y) → (−y, x), avoiding cos/sin float dust
    const rot90 = matrix(0, 1, -1, 0, 0, 0);
    expect(transform(rect(0, 0, 10, 10), rot90)).toEqual({ x: -10, y: 0, width: 10, height: 10 });
  });
});
