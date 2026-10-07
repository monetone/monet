// ─────────────────────────────────────────────────────────────
// tools/grid-geometry.test — Rectangular / Polar Grid geometry (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Rectangular Grid (a bounding rectangle + evenly
// spaced horizontal/vertical dividers) and Polar Grid (concentric rings + radial
// spokes), both drawn by dragging the bounding box.

import { describe, it, expect } from "vitest";
import { rectGrid, polarGrid } from "./path-shapes";

describe("rectGrid", () => {
  it("5×5 grid → border + 4 vertical + 4 horizontal dividers (9 subpaths), spanning the bbox", () => {
    const subs = rectGrid({ x: 0, y: 0 }, { x: 100, y: 200 });
    expect(subs.length).toBe(9);

    const border = subs[0];
    expect(border.closed).toBe(true);
    const bx = border.anchors.map((a) => a.point.x);
    const by = border.anchors.map((a) => a.point.y);
    expect([Math.min(...bx), Math.max(...bx)]).toEqual([0, 100]);
    expect([Math.min(...by), Math.max(...by)]).toEqual([0, 200]);

    const verticals = subs.slice(1).filter((s) => !s.closed && s.anchors[0].point.x === s.anchors[1].point.x);
    expect(verticals.map((s) => s.anchors[0].point.x).sort((a, b) => a - b)).toEqual([20, 40, 60, 80]);
    verticals.forEach((s) => expect(s.anchors.map((a) => a.point.y).sort((a, b) => a - b)).toEqual([0, 200])); // full height

    const horizontals = subs.slice(1).filter((s) => !s.closed && s.anchors[0].point.y === s.anchors[1].point.y);
    expect(horizontals.map((s) => s.anchors[0].point.y).sort((a, b) => a - b)).toEqual([40, 80, 120, 160]);
  });

  it("normalizes a reversed drag (cur above-left of start)", () => {
    const subs = rectGrid({ x: 100, y: 200 }, { x: 0, y: 0 });
    const bx = subs[0].anchors.map((a) => a.point.x);
    expect([Math.min(...bx), Math.max(...bx)]).toEqual([0, 100]);
  });

  it("honours custom divider counts", () => {
    const subs = rectGrid({ x: 0, y: 0 }, { x: 100, y: 100 }, 2, 3); // 2 cols, 3 rows
    expect(subs.length).toBe(1 + (2 - 1) + (3 - 1)); // border + 1 vertical + 2 horizontal = 4
  });
});

describe("polarGrid", () => {
  it("4 rings + 8 spokes = 12 subpaths; outer ring radius R; spokes start at the centre", () => {
    const subs = polarGrid({ x: 0, y: 0 }, 100);
    expect(subs.length).toBe(12);
    const rings = subs.filter((s) => s.closed);
    const spokes = subs.filter((s) => !s.closed);
    expect(rings.length).toBe(4);
    expect(spokes.length).toBe(8);
    expect(Math.max(...rings.flatMap((r) => r.anchors.map((a) => a.point.x)))).toBeCloseTo(100); // outer reaches R
    spokes.forEach((s) => expect(s.anchors[0].point).toEqual({ x: 0, y: 0 })); // from the centre
  });
});
