// ─────────────────────────────────────────────────────────────
// engine/star.test — two-radius star geometry (starPath)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Star — an N-pointed star alternates vertices
// between an OUTER radius (radius1) and an INNER radius (radius2); the first
// point sits at the top. 5 points → 10 vertices.

import { describe, it, expect } from "vitest";
import { Shapes } from "./index";

const dist = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

describe("starPath — two-radius star geometry", () => {
  it("a 5-point star has 10 vertices alternating outer/inner radius", () => {
    const g = Shapes.starPath(50, 25, 5);
    expect(g.closed).toBe(true);
    expect(g.anchors).toHaveLength(10);
    g.anchors.forEach((a, i) => {
      expect(dist(a.point)).toBeCloseTo(i % 2 === 0 ? 50 : 25, 6); // even=outer, odd=inner
    });
  });

  it("the first vertex is the top outer point (straight up)", () => {
    const g = Shapes.starPath(40, 20, 5);
    expect(g.anchors[0].point.x).toBeCloseTo(0, 6);
    expect(g.anchors[0].point.y).toBeCloseTo(-40, 6); // SVG y-down → up is negative
  });

  it("the vertices are evenly spaced by 2π/(2N)", () => {
    const g = Shapes.starPath(30, 15, 6); // 12 vertices, 30° apart
    const ang = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
    let prev = ang(g.anchors[0].point);
    for (let i = 1; i < g.anchors.length; i++) {
      const cur = ang(g.anchors[i].point);
      let d = cur - prev;
      while (d < 0) d += Math.PI * 2;
      expect(d).toBeCloseTo(Math.PI / 6, 5); // 2π/12
      prev = cur;
    }
  });

  it("points are clamped to a minimum of 3 (→ 6 vertices)", () => {
    expect(Shapes.starPath(10, 5, 2).anchors).toHaveLength(6);
  });
});
