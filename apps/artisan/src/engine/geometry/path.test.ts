// ─────────────────────────────────────────────────────────────
// path.test — anchor-based vector path geometry
// ─────────────────────────────────────────────────────────────
// The capstone of the geometry layer (matrix/bezier/bbox already covered). path
// drives SVG export, fill/stroke hit-testing, orientation and anchor editing.
// Fixtures: a corner-only closed square (straight segments) and the bezier arch
// reused from bezier.test, so tight bounds vs the control hull can be compared.

import { describe, it, expect } from "vitest";
import { pt, ZERO, type Point } from "./vec";
import { scaling, translation } from "./matrix";
import {
  anchor,
  bounds,
  containsPoint,
  controlBounds,
  distanceToPoint,
  flatten,
  hitsOutline,
  insertAnchor,
  isClockwise,
  length,
  nearest,
  path,
  removeAnchor,
  reverse,
  samplePoints,
  segments,
  signedArea,
  toSVGPath,
  transform,
  widthOutline,
} from "./path";

const near = (p: Point, x: number, y: number, d = 6) => {
  expect(p.x).toBeCloseTo(x, d);
  expect(p.y).toBeCloseTo(y, d);
};

/** Corner-only closed unit square (0,0)→(10,0)→(10,10)→(0,10). */
const square = () =>
  path([anchor(pt(0, 0)), anchor(pt(10, 0)), anchor(pt(10, 10)), anchor(pt(0, 10))], true);
/** One cubic: the symmetric arch (0,0)·(0,10)·(10,10)·(10,0) via relative handles. */
const arch = () => path([anchor(pt(0, 0), ZERO, pt(0, 10)), anchor(pt(10, 0), pt(0, 10), ZERO)], false);
/** Open horizontal segment. */
const seg = () => path([anchor(pt(0, 0)), anchor(pt(10, 0))], false);

describe("constructors", () => {
  it("anchor defaults handles to zero and copies the inputs", () => {
    const h = pt(1, 2);
    const a = anchor(pt(0, 0), h);
    expect(a.handleOut).toEqual({ x: 0, y: 0 });
    h.x = 99;
    expect(a.handleIn.x).toBe(1); // copied, not aliased
  });
  it("path defaults to empty + open", () => {
    expect(path()).toEqual({ anchors: [], closed: false });
  });
});

describe("segments", () => {
  it("needs at least two anchors", () => {
    expect(segments(path([anchor(pt(0, 0))]))).toEqual([]);
  });
  it("emits one span per drawn edge, plus the closing span when closed", () => {
    expect(segments(square())).toHaveLength(4); // 3 edges + closing
    expect(segments(arch())).toHaveLength(1);
  });
  it("corner anchors yield straight cubics (controls at the endpoints)", () => {
    const s = segments(square())[0];
    expect(s).toEqual({ p0: pt(0, 0), p1: pt(0, 0), p2: pt(10, 0), p3: pt(10, 0) });
  });
});

describe("toSVGPath", () => {
  it("is empty for an empty path", () => {
    expect(toSVGPath(path())).toBe("");
  });
  it("emits L for straight spans and an implicit Z close", () => {
    expect(toSVGPath(square())).toBe("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  });
  it("emits C from the handle control points", () => {
    expect(toSVGPath(arch())).toBe("M 0 0 C 0 10 10 10 10 0");
  });
  it("rounds coordinates to 3 decimals", () => {
    expect(toSVGPath(path([anchor(pt(1.23456, 2)), anchor(pt(3, 4))]))).toBe("M 1.235 2 L 3 4");
  });
});

describe("flatten", () => {
  it("returns anchor points when there are no segments", () => {
    expect(flatten(path([anchor(pt(2, 3))]))).toEqual([pt(2, 3)]);
  });
  it("starts at the first point and reaches the last", () => {
    const f = flatten(seg());
    near(f[0], 0, 0);
    near(f[f.length - 1], 10, 0);
  });
});

describe("bounds vs controlBounds", () => {
  it("bounds is the tight geometric box (arch apex 7.5, not the hull's 10)", () => {
    expect(bounds(arch())).toEqual({ x: 0, y: 0, width: 10, height: 7.5 });
    expect(bounds(square())).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
  it("controlBounds includes the handles (arch hull height 10)", () => {
    expect(controlBounds(arch())).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe("length", () => {
  it("sums the segment arc lengths (square perimeter = 40)", () => {
    expect(length(square())).toBeCloseTo(40, 3);
  });
});

describe("nearest / hit-testing", () => {
  it("nearest projects onto the closest segment", () => {
    const h = nearest(square(), pt(5, -3))!;
    expect(h).toBeTruthy();
    near(h.point, 5, 0, 4);
    expect(h.dist).toBeCloseTo(3, 4);
    expect(h.segIndex).toBe(0); // the top edge
  });
  it("nearest is null for a path with no segments", () => {
    expect(nearest(path([anchor(pt(0, 0))]), pt(0, 0))).toBeNull();
  });
  it("hitsOutline / distanceToPoint respect the tolerance", () => {
    expect(hitsOutline(square(), pt(5, -3), 3.5)).toBe(true);
    expect(hitsOutline(square(), pt(5, -3), 2)).toBe(false);
    expect(distanceToPoint(square(), pt(5, -3))).toBeCloseTo(3, 4);
  });
});

describe("containsPoint", () => {
  it("is true inside and false outside the fill", () => {
    expect(containsPoint(square(), pt(5, 5))).toBe(true);
    expect(containsPoint(square(), pt(15, 5))).toBe(false);
    expect(containsPoint(square(), pt(5, -1))).toBe(false);
  });
  it("needs at least three anchors", () => {
    expect(containsPoint(seg(), pt(5, 0))).toBe(false);
  });
  it("agrees with the even-odd rule for a simple polygon", () => {
    expect(containsPoint(square(), pt(5, 5), true)).toBe(true);
    expect(containsPoint(square(), pt(15, 5), true)).toBe(false);
  });
});

describe("transform", () => {
  it("translates points while leaving (relative) handles unchanged", () => {
    const t = transform(square(), translation(100, 200));
    near(t.anchors[0].point, 100, 200);
    near(t.anchors[2].point, 110, 210);
  });
  it("applies only the linear part to handles", () => {
    const t = transform(arch(), scaling(2));
    near(t.anchors[0].point, 0, 0); // origin point unchanged by scale
    near(t.anchors[0].handleOut, 0, 20); // handle (0,10) scaled ×2
  });
});

describe("reverse", () => {
  it("reverses anchor order and swaps the handles", () => {
    const r = reverse(arch());
    near(r.anchors[0].point, 10, 0); // was the last anchor
    near(r.anchors[0].handleOut, 0, 10); // old handleIn becomes handleOut
  });
});

describe("anchor editing", () => {
  it("insertAnchor splits a segment, adding the on-curve midpoint", () => {
    const r = insertAnchor(seg(), 0, 0.5);
    expect(r.anchors).toHaveLength(3);
    near(r.anchors[1].point, 5, 0);
  });
  it("insertAnchor / removeAnchor are no-ops (same ref) for out-of-range indices", () => {
    const s = seg();
    expect(insertAnchor(s, 5, 0.5)).toBe(s);
    const sq = square();
    expect(removeAnchor(sq, 9)).toBe(sq);
  });
  it("removeAnchor drops the anchor at the index", () => {
    expect(removeAnchor(square(), 1).anchors).toHaveLength(3);
  });
});

describe("orientation", () => {
  it("reverse flips the signed area; |area| of the square is 100", () => {
    const a = signedArea(square());
    expect(Math.abs(a)).toBeCloseTo(100, 3);
    expect(signedArea(reverse(square()))).toBeCloseTo(-a, 3);
  });
  it("isClockwise disagrees between a path and its reverse", () => {
    expect(isClockwise(square())).not.toBe(isClockwise(reverse(square())));
  });
});

describe("samplePoints", () => {
  it("samples perSegment points per segment, plus the final endpoint when open", () => {
    expect(samplePoints(square(), 2)).toHaveLength(8); // 4 segments × 2
    expect(samplePoints(seg(), 3)).toHaveLength(4); // 1 segment × 3 + final endpoint
  });
});

describe("widthOutline", () => {
  it("returns one ring for an open path and two for a closed one; empty otherwise", () => {
    expect(widthOutline(path(), [1], 4)).toEqual([]);
    expect(widthOutline(seg(), [1, 1], 4)).toHaveLength(1);
    const rings = widthOutline(square(), [1, 1, 1, 1], 4);
    expect(rings).toHaveLength(2);
    expect(rings[0].closed).toBe(true);
  });

  it("uses one wrapped normal at a closed path's seam", () => {
    const rings = widthOutline(square(), [1, 1, 1, 1], 2);
    const seam = rings[0].anchors[0].point;
    expect(Math.abs(seam.x)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(seam.y)).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
