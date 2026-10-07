// ─────────────────────────────────────────────────────────────
// bezier.test — cubic Bézier segment math
// ─────────────────────────────────────────────────────────────
// The geometry layer had only matrix coverage; bezier is the workhorse for
// every path (eval/split/bbox/length/projection). Pin the math with a known
// symmetric arch C = (0,0)·(0,10)·(10,10)·(10,0) and a few degenerate cases.

import { describe, it, expect } from "vitest";
import { pt, type Point } from "./vec";
import {
  bbox,
  cubic,
  derivative,
  evaluate,
  extrema,
  flatten,
  fromHandles,
  length,
  line,
  project,
  reverse,
  segMid,
  split,
  subcurve,
  tangentAt,
} from "./bezier";

/** Symmetric arch: rises to (5, 7.5) at t=0.5, returns to the baseline. */
const C = cubic(pt(0, 0), pt(0, 10), pt(10, 10), pt(10, 0));

const near = (p: Point, x: number, y: number, digits = 9) => {
  expect(p.x).toBeCloseTo(x, digits);
  expect(p.y).toBeCloseTo(y, digits);
};

describe("constructors", () => {
  it("cubic stores the four control points", () => {
    expect(cubic(pt(1, 2), pt(3, 4), pt(5, 6), pt(7, 8))).toEqual({ p0: pt(1, 2), p1: pt(3, 4), p2: pt(5, 6), p3: pt(7, 8) });
  });
  it("line is the degenerate cubic with controls at the endpoints", () => {
    expect(line(pt(0, 0), pt(10, 20))).toEqual({ p0: pt(0, 0), p1: pt(0, 0), p2: pt(10, 20), p3: pt(10, 20) });
  });
});

describe("evaluate", () => {
  it("pins the endpoints exactly", () => {
    expect(evaluate(C, 0)).toEqual(pt(0, 0));
    expect(evaluate(C, 1)).toEqual(pt(10, 0));
  });
  it("hits the symmetric midpoint and a known interior sample", () => {
    near(evaluate(C, 0.5), 5, 7.5);
    near(evaluate(C, 0.25), 1.5625, 5.625);
  });
  it("segMid equals evaluate at t=0.5", () => {
    expect(segMid(C)).toEqual(evaluate(C, 0.5));
  });
});

describe("derivative & tangent", () => {
  it("derivative at the ends is 3·(p1−p0) and 3·(p3−p2)", () => {
    near(derivative(C, 0), 0, 30);
    near(derivative(C, 1), 0, -30);
  });
  it("tangentAt returns a unit vector along the derivative", () => {
    near(tangentAt(C, 0), 0, 1);
    near(tangentAt(C, 1), 0, -1);
  });
  it("tangentAt degrades to (1,0) at a stationary point", () => {
    const dot = cubic(pt(5, 5), pt(5, 5), pt(5, 5), pt(5, 5)); // zero derivative everywhere
    expect(tangentAt(dot, 0.5)).toEqual({ x: 1, y: 0 });
  });
});

describe("extrema & bbox", () => {
  it("finds the single y-extremum at the apex", () => {
    expect(extrema(C)).toEqual([0.5]);
  });
  it("bbox is tighter than the control hull (height 7.5, not 10)", () => {
    expect(bbox(C)).toEqual({ x: 0, y: 0, width: 10, height: 7.5 });
  });
});

describe("split", () => {
  it("is C0-continuous at the seam and meets the curve midpoint", () => {
    const [l, r] = split(C, 0.5);
    expect(l.p3).toEqual(r.p0); // shared point
    near(l.p3, 5, 7.5); // = evaluate(C, 0.5)
    expect(l.p0).toEqual(C.p0);
    expect(r.p3).toEqual(C.p3);
  });
  it("reparametrizes each half onto the original curve", () => {
    const [l, r] = split(C, 0.5);
    near(evaluate(l, 0.5), evaluate(C, 0.25).x, evaluate(C, 0.25).y);
    near(evaluate(r, 0.5), evaluate(C, 0.75).x, evaluate(C, 0.75).y);
  });
});

describe("subcurve", () => {
  it("returns the whole curve for [0,1]", () => {
    expect(subcurve(C, 0, 1)).toEqual(C);
  });
  it("endpoints match the curve at t0/t1", () => {
    const s = subcurve(C, 0.25, 0.75);
    near(evaluate(s, 0), evaluate(C, 0.25).x, evaluate(C, 0.25).y, 6);
    near(evaluate(s, 1), evaluate(C, 0.75).x, evaluate(C, 0.75).y, 6);
  });
  it("is order-independent in its parameters", () => {
    expect(subcurve(C, 0.75, 0.25)).toEqual(subcurve(C, 0.25, 0.75));
  });
});

describe("flatten & length", () => {
  it("a properly-parametrized straight cubic flattens to one point with exact length", () => {
    const S = cubic(pt(0, 0), pt(10, 40 / 3), pt(20, 80 / 3), pt(30, 40)); // collinear, controls at 1/3 & 2/3
    expect(flatten(S)).toHaveLength(1);
    near(flatten(S)[0], 30, 40);
    expect(length(S)).toBeCloseTo(50, 6); // = |(30,40)|
  });
  it("arc length is bounded by the chord below and the control polygon above", () => {
    const chord = 10; // |p0→p3|
    const polygon = 30; // 10 + 10 + 10
    const L = length(C);
    expect(L).toBeGreaterThan(chord);
    expect(L).toBeLessThan(polygon);
  });
});

describe("project", () => {
  it("finds the nearest point on a line segment", () => {
    const L = line(pt(0, 0), pt(10, 0));
    const r = project(L, pt(5, 5));
    expect(r.t).toBeCloseTo(0.5, 4);
    near(r.point, 5, 0, 4);
    expect(r.dist).toBeCloseTo(5, 4);
  });
  it("projects the endpoints to t≈0 and t≈1 with ~zero distance", () => {
    expect(project(C, C.p0).t).toBeCloseTo(0, 4);
    expect(project(C, C.p0).dist).toBeCloseTo(0, 4);
    expect(project(C, C.p3).t).toBeCloseTo(1, 4);
  });
});

describe("reverse & fromHandles", () => {
  it("reverse swaps direction: B_rev(t) = B(1−t)", () => {
    expect(reverse(C)).toEqual({ p0: C.p3, p1: C.p2, p2: C.p1, p3: C.p0 });
    near(evaluate(reverse(C), 0.3), evaluate(C, 0.7).x, evaluate(C, 0.7).y);
  });
  it("fromHandles offsets handles from their anchors", () => {
    const c = fromHandles(pt(0, 0), pt(2, 3), pt(10, 0), pt(-1, 4));
    expect(c).toEqual({ p0: pt(0, 0), p1: pt(2, 3), p2: pt(9, 4), p3: pt(10, 0) });
  });
});
