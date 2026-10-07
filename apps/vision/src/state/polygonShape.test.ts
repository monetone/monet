// Unit tests for the Polygon shape's pure vertex geometry. Engine-free (node);
// the Shape-tool fill is covered by e2e/polygon-shape.spec.ts.
import { describe, it, expect } from "vitest";
import { polygonVertices, POLYGON_MIN_SIDES, POLYGON_MAX_SIDES } from "./polygonShape";

const dist = (x: number, y: number, cx = 0, cy = 0) => Math.hypot(x - cx, y - cy);

describe("polygonVertices", () => {
  it("returns exactly `sides` vertices for a regular polygon", () => {
    expect(polygonVertices(0, 0, 10, 10, 3).length).toBe(6); // triangle → 3 pts
    expect(polygonVertices(0, 0, 10, 10, 4).length).toBe(8); // square
    expect(polygonVertices(0, 0, 10, 10, 5).length).toBe(10); // pentagon
  });

  it("places the first vertex at the top (cx, cy-ry) by default", () => {
    const v = polygonVertices(50, 40, 30, 20, 6);
    expect(v[0]).toBeCloseTo(50, 5); // x = cx
    expect(v[1]).toBeCloseTo(20, 5); // y = cy - ry
  });

  it("inscribes a regular polygon on the bounding ellipse", () => {
    const v = polygonVertices(0, 0, 10, 10, 6);
    for (let i = 0; i < v.length / 2; i++) {
      expect(dist(v[i * 2], v[i * 2 + 1])).toBeCloseTo(10, 4); // all on radius 10
    }
  });

  it("alternates outer/inner radius for a star (2*sides vertices)", () => {
    const v = polygonVertices(0, 0, 10, 10, 5, true, 0.5);
    expect(v.length).toBe(20); // 5-point star → 10 vertices
    for (let i = 0; i < v.length / 2; i++) {
      const r = dist(v[i * 2], v[i * 2 + 1]);
      expect(r).toBeCloseTo(i % 2 === 0 ? 10 : 5, 4); // even=outer 10, odd=inner 5
    }
  });

  it("clamps sides to [3,24]", () => {
    expect(polygonVertices(0, 0, 10, 10, 2).length).toBe(POLYGON_MIN_SIDES * 2); // 3 → 6 numbers
    expect(polygonVertices(0, 0, 10, 10, 100).length).toBe(POLYGON_MAX_SIDES * 2); // 24 → 48 numbers
    expect(POLYGON_MIN_SIDES).toBe(3);
    expect(POLYGON_MAX_SIDES).toBe(24);
  });

  it("clamps the star indent into (0,1]", () => {
    const v = polygonVertices(0, 0, 10, 10, 4, true, 5); // indent > 1 clamps to 1
    const inner = dist(v[2], v[3]); // odd index = inner
    expect(inner).toBeCloseTo(10, 4);
  });
});
