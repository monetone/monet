// ─────────────────────────────────────────────────────────────
// geometry/offset.test — constant-distance polygon offset (Offset Path math)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Object ▸ Path ▸ Offset Path — a positive offset
// grows the path outward, a negative one shrinks it inward, and corners are
// rejoined with Miter / Round / Bevel (the miter limit turns long spikes into
// bevels). A square offset outward by d becomes a square enlarged by d on every
// side; with round joins it is the Minkowski sum with a disk of radius d.

import { describe, it, expect } from "vitest";
import type { Point } from "./vec";
import { cleanPolygon, offsetPolygon } from "./offset";

const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const area = (poly: Point[]): number => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a / 2);
};
const bbox = (poly: Point[]) => ({
  minX: Math.min(...poly.map((p) => p.x)),
  minY: Math.min(...poly.map((p) => p.y)),
  maxX: Math.max(...poly.map((p) => p.x)),
  maxY: Math.max(...poly.map((p) => p.y)),
});
const hasPoint = (poly: Point[], x: number, y: number) =>
  poly.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);

describe("geometry/offset.offsetPolygon — miter join", () => {
  it("grows a square outward by the exact offset on every side (+10 ⇒ 120×120)", () => {
    const out = offsetPolygon(SQUARE, { distance: 10, join: "miter" });
    expect(out).toHaveLength(4); // four sharp corners, no spurious vertices
    const b = bbox(out);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([-10, -10, 110, 110]);
    expect(area(out)).toBeCloseTo(120 * 120, 6);
    for (const [x, y] of [[-10, -10], [110, -10], [110, 110], [-10, 110]]) {
      expect(hasPoint(out, x, y)).toBe(true);
    }
  });

  it("shrinks a square inward for a negative offset (−10 ⇒ 80×80)", () => {
    const out = offsetPolygon(SQUARE, { distance: -10, join: "miter" });
    expect(out).toHaveLength(4);
    const b = bbox(out);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([10, 10, 90, 90]);
    expect(area(out)).toBeCloseTo(80 * 80, 6);
  });

  it("returns nothing once an inset collapses the shape", () => {
    expect(offsetPolygon(SQUARE, { distance: -50, join: "miter" })).toEqual([]);
    expect(offsetPolygon(SQUARE, { distance: -60, join: "miter" })).toEqual([]);
    const lShape: Point[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 },
      { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 },
    ];
    expect(offsetPolygon(lShape, { distance: -15, join: "miter" })).toEqual([]);
  });

  it("offsets outward identically regardless of winding direction", () => {
    const ccw = [...SQUARE].reverse();
    const out = offsetPolygon(ccw, { distance: 10, join: "miter" });
    const b = bbox(out);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([-10, -10, 110, 110]);
    expect(area(out)).toBeCloseTo(120 * 120, 6);
  });
});

describe("geometry/offset.offsetPolygon — bevel & round joins", () => {
  it("bevel cuts each convex corner into two points (square ⇒ 8 vertices)", () => {
    const out = offsetPolygon(SQUARE, { distance: 10, join: "bevel" });
    expect(out).toHaveLength(8);
    // 120×120 box minus four 10×10 corner triangles
    expect(area(out)).toBeCloseTo(120 * 120 - 4 * (10 * 10) / 2, 6);
  });

  it("round replaces each corner with an arc (area ≈ Minkowski sum with a disk)", () => {
    const out = offsetPolygon(SQUARE, { distance: 10, join: "round" });
    expect(out.length).toBeGreaterThan(8); // arcs add intermediate points
    // A ⊕ disk(d): area = A + perimeter·d + π·d² = 14314.2. The arcs are chorded,
    // so the polygon area sits just under that exact value but well above bevel's.
    const minkowski = 100 * 100 + 400 * 10 + Math.PI * 10 * 10;
    const bevelArea = 120 * 120 - 4 * (10 * 10) / 2; // 14200
    expect(area(out)).toBeGreaterThan(bevelArea);
    expect(area(out)).toBeLessThanOrEqual(minkowski + 0.5);
    expect(area(out)).toBeGreaterThan(minkowski - 20);
    // the offset still reaches exactly distance 10 on every side
    const b = bbox(out);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([-10, -10, 110, 110]);
  });
});

describe("geometry/offset.offsetPolygon — miter limit", () => {
  // A right triangle: one 90° corner (miter ratio √2 ≈ 1.41) and two 45° corners
  // (miter ratio 1/sin22.5° ≈ 2.61). The miter limit decides which spikes bevel.
  const triangle: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];

  it("keeps every corner mitered (single vertex each) when the limit is high", () => {
    const out = offsetPolygon(triangle, { distance: 5, join: "miter", miterLimit: 10 });
    expect(out).toHaveLength(3);
  });

  it("bevels only the corners whose miter ratio exceeds the limit", () => {
    // limit 2: the 90° corner (1.41) stays; the two 45° corners (2.61) bevel into
    // two points each ⇒ 1 + 2 + 2 = 5 vertices.
    const out = offsetPolygon(triangle, { distance: 5, join: "miter", miterLimit: 2 });
    expect(out).toHaveLength(5);
  });

  it("lowering the miter limit never reduces the vertex count (more bevels)", () => {
    const hi = offsetPolygon(triangle, { distance: 5, join: "miter", miterLimit: 10 }).length;
    const lo = offsetPolygon(triangle, { distance: 5, join: "miter", miterLimit: 1.2 }).length;
    expect(lo).toBeGreaterThanOrEqual(hi);
  });
});

describe("geometry/offset.cleanPolygon", () => {
  it("removes collinear points so a subdivided edge still offsets to 4 corners", () => {
    const subdivided: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 }, // extra collinear midpoint on the top edge
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(cleanPolygon(subdivided)).toHaveLength(4);
    const out = offsetPolygon(subdivided, { distance: 10, join: "miter" });
    expect(out).toHaveLength(4);
    expect(area(out)).toBeCloseTo(120 * 120, 6);
  });

  it("drops the duplicated closing point", () => {
    const closed: Point[] = [...SQUARE, { x: 0, y: 0 }];
    expect(cleanPolygon(closed)).toHaveLength(4);
  });

  it("zero distance returns the cleaned polygon unchanged", () => {
    const out = offsetPolygon(SQUARE, { distance: 0 });
    expect(out).toHaveLength(4);
    expect(area(out)).toBeCloseTo(100 * 100, 6);
  });
});
