import { describe, expect, it } from "vitest";
import { boundsOfPoints, unionRect, frameView, centerDelta } from "./frame";

describe("boundsOfPoints", () => {
  it("returns null for no points", () => {
    expect(boundsOfPoints([])).toBeNull();
  });

  it("wraps a single point as a zero-size rect", () => {
    expect(boundsOfPoints([{ x: 7, y: 9 }])).toEqual({ x: 7, y: 9, w: 0, h: 0 });
  });

  it("computes the tight AABB of a point cloud", () => {
    const r = boundsOfPoints([
      { x: 10, y: 4 },
      { x: -2, y: 20 },
      { x: 6, y: -5 },
    ]);
    expect(r).toEqual({ x: -2, y: -5, w: 12, h: 25 });
  });
});

describe("unionRect", () => {
  it("passes through when one side is null", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(unionRect(a, null)).toBe(a);
    expect(unionRect(null, a)).toBe(a);
    expect(unionRect(null, null)).toBeNull();
  });

  it("unions two disjoint rects into their enclosing box", () => {
    const a = { x: 0, y: 0, w: 20, h: 20 };
    const b = { x: 100, y: 50, w: 10, h: 10 };
    expect(unionRect(a, b)).toEqual({ x: 0, y: 0, w: 110, h: 60 });
  });

  it("is unaffected by a fully-contained rect", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 40, y: 40, w: 10, h: 10 };
    expect(unionRect(a, b)).toEqual(a);
  });
});

describe("frameView", () => {
  it("centres on the box centre", () => {
    const v = frameView({ x: 100, y: 50, w: 40, h: 20 }, 800, 600, { maxZoom: 100 });
    expect(v.centerX).toBe(120);
    expect(v.centerY).toBe(60);
  });

  it("fits a square box equally on both axes (no padding)", () => {
    const v = frameView({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000, { pad: 0, maxZoom: 100 });
    expect(v.zoom).toBeCloseTo(10, 6); // 1000/100
    expect(v.centerX).toBe(50);
    expect(v.centerY).toBe(50);
  });

  it("is constrained by width for a wide (landscape) box", () => {
    const v = frameView({ x: 0, y: 0, w: 200, h: 50 }, 800, 800, { pad: 0, maxZoom: 100 });
    expect(v.zoom).toBeCloseTo(4, 6); // min(800/200, 800/50) = 4
  });

  it("is constrained by height for a tall (portrait) box", () => {
    const v = frameView({ x: 0, y: 0, w: 50, h: 200 }, 800, 800, { pad: 0, maxZoom: 100 });
    expect(v.zoom).toBeCloseTo(4, 6); // min(800/50, 800/200) = 4
  });

  it("subtracts padding from the usable viewport on both sides", () => {
    const v = frameView({ x: 0, y: 0, w: 100, h: 100 }, 300, 300, { pad: 50, maxZoom: 100 });
    expect(v.zoom).toBeCloseTo(2, 6); // usable 200x200 → 200/100
  });

  it("clamps to maxZoom for a tiny box and to a point-box", () => {
    const tiny = frameView({ x: 10, y: 20, w: 2, h: 2 }, 800, 600, { maxZoom: 8 });
    expect(tiny.zoom).toBe(8);
    expect(tiny.centerX).toBe(11);
    expect(tiny.centerY).toBe(21);

    const point = frameView({ x: 10, y: 20, w: 0, h: 0 }, 800, 600, { maxZoom: 8 });
    expect(point.zoom).toBe(8); // no finite fit → maxZoom
    expect(point.centerX).toBe(10);
    expect(point.centerY).toBe(20);
  });

  it("clamps to minZoom for a box larger than the viewport allows", () => {
    const v = frameView({ x: 0, y: 0, w: 100000, h: 100000 }, 800, 600, { minZoom: 0.1, maxZoom: 8 });
    expect(v.zoom).toBe(0.1);
    expect(v.centerX).toBe(50000);
    expect(v.centerY).toBe(50000);
  });

  it("never lets padding drive the usable viewport to zero or negative", () => {
    const v = frameView({ x: 0, y: 0, w: 10, h: 10 }, 80, 80, { pad: 100, maxZoom: 100 });
    expect(Number.isFinite(v.zoom)).toBe(true);
    expect(v.zoom).toBeGreaterThan(0);
  });
});

describe("centerDelta", () => {
  it("moves a single point exactly onto the target", () => {
    expect(centerDelta([{ x: 100, y: 100 }], { x: 500, y: 300 })).toEqual({ dx: 400, dy: 200 });
  });

  it("centres a group's bounding box on the target (preserving relative layout)", () => {
    // points span x 100..300 (centre 200), y 50..150 (centre 100)
    const d = centerDelta([{ x: 100, y: 50 }, { x: 300, y: 150 }], { x: 0, y: 0 });
    expect(d).toEqual({ dx: -200, dy: -100 });
  });

  it("is a no-op when already centred on the target", () => {
    expect(centerDelta([{ x: 10, y: 20 }, { x: 30, y: 40 }], { x: 20, y: 30 })).toEqual({ dx: 0, dy: 0 });
  });

  it("returns no movement for an empty set", () => {
    expect(centerDelta([], { x: 5, y: 5 })).toEqual({ dx: 0, dy: 0 });
  });
});
