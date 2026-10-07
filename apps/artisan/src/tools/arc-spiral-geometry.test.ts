// ─────────────────────────────────────────────────────────────
// tools/arc-spiral-geometry.test — Arc + Spiral geometry (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Arc tool draws an open quarter-ellipse between the
// drag corners; the Spiral tool draws an open path winding from the outer radius
// toward the centre. Both are drawn by dragging.

import { describe, it, expect } from "vitest";
import { arcGeometry, spiralGeometry } from "./path-shapes";

const K = 0.5523; // quarter-ellipse bezier constant used by the arc

describe("arcGeometry", () => {
  it("is an open 2-anchor quarter-ellipse from start to cur with KAPPA handles", () => {
    const g = arcGeometry({ x: 0, y: 0 }, { x: 100, y: 60 });
    expect(g.closed).toBe(false);
    expect(g.anchors.length).toBe(2);
    expect(g.anchors[0].point).toEqual({ x: 0, y: 0 });
    expect(g.anchors[1].point).toEqual({ x: 100, y: 60 });
    expect(g.anchors[0].handleOut.x).toBeCloseTo(0); // leaves start vertically
    expect(g.anchors[0].handleOut.y).toBeCloseTo(60 * K);
    expect(g.anchors[1].handleIn.x).toBeCloseTo(-100 * K); // arrives at cur horizontally
    expect(g.anchors[1].handleIn.y).toBeCloseTo(0);
  });

  it("the curve bulges away from the straight chord (it is an arc, not a line)", () => {
    const g = arcGeometry({ x: 0, y: 0 }, { x: 100, y: 60 });
    const [a0, a1] = g.anchors;
    const p0 = a0.point, p3 = a1.point;
    const p1 = { x: p0.x + a0.handleOut.x, y: p0.y + a0.handleOut.y };
    const p2 = { x: p3.x + a1.handleIn.x, y: p3.y + a1.handleIn.y };
    const at = (a: number, b: number, c: number, d: number) => 0.125 * a + 0.375 * b + 0.375 * c + 0.125 * d; // t = 0.5
    const mid = { x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) };
    expect(Math.hypot(mid.x - 50, mid.y - 30)).toBeGreaterThan(5); // far from the chord midpoint (50,30)
  });
});

describe("spiralGeometry", () => {
  it("winds from the outer radius (R) toward the centre, open path", () => {
    const start = { x: 200, y: 200 };
    const g = spiralGeometry(start, { x: 300, y: 200 }); // R = 100
    expect(g.closed).toBe(false);
    expect(g.anchors.length).toBe(37); // 3 turns × 12 steps + 1
    const radii = g.anchors.map((a) => Math.hypot(a.point.x - start.x, a.point.y - start.y));
    expect(Math.max(...radii)).toBeCloseTo(100, 0); // outer end ≈ R
    expect(Math.min(...radii)).toBeLessThan(20); // inner end near the centre
    expect(radii[0]).toBeGreaterThan(radii[radii.length - 1] * 2); // first anchor = outer, last = inner
  });

  it("a near-zero drag yields a single point", () => {
    expect(spiralGeometry({ x: 0, y: 0 }, { x: 0.5, y: 0 }).anchors.length).toBe(1);
  });
});
