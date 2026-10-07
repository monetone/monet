// ─────────────────────────────────────────────────────────────
// bezier — cubic Bézier segment math
// ─────────────────────────────────────────────────────────────
// A cubic segment is four points p0..p3 (p0/p3 on-curve, p1/p2 control). A line
// is the degenerate cubic with p1=p0, p2=p3. Everything here is pure.

import {
  add,
  dist,
  lerp,
  type Point,
  scale,
  sub,
} from "./vec";
import { fromPoints, type Rect } from "./bbox";

export interface Cubic {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

export const cubic = (p0: Point, p1: Point, p2: Point, p3: Point): Cubic => ({ p0, p1, p2, p3 });

export const line = (a: Point, b: Point): Cubic => ({ p0: a, p1: a, p2: b, p3: b });

/** Evaluate the curve at parameter t ∈ [0,1]. */
export const evaluate = (c: Cubic, t: number): Point => {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const a = uu * u;
  const b = 3 * uu * t;
  const d = 3 * u * tt;
  const e = tt * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
};

/** First derivative B'(t) (a tangent vector, not normalized). */
export const derivative = (c: Cubic, t: number): Point => {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const d = 3 * t * t;
  return {
    x: a * (c.p1.x - c.p0.x) + b * (c.p2.x - c.p1.x) + d * (c.p3.x - c.p2.x),
    y: a * (c.p1.y - c.p0.y) + b * (c.p2.y - c.p1.y) + d * (c.p3.y - c.p2.y),
  };
};

const quadRootsIn01 = (a: number, b: number, cc: number): number[] => {
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -cc / b;
      if (t > 0 && t < 1) out.push(t);
    }
    return out;
  }
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return out;
  const sq = Math.sqrt(disc);
  const t1 = (-b + sq) / (2 * a);
  const t2 = (-b - sq) / (2 * a);
  if (t1 > 0 && t1 < 1) out.push(t1);
  if (t2 > 0 && t2 < 1) out.push(t2);
  return out;
};

/** Parameters where the derivative is zero on one axis (curve extrema). */
export const extrema = (c: Cubic): number[] => {
  const ts: number[] = [];
  for (const axis of ["x", "y"] as const) {
    const A = c.p1[axis] - c.p0[axis];
    const C = c.p2[axis] - c.p1[axis];
    const D = c.p3[axis] - c.p2[axis];
    const a = A - 2 * C + D;
    const b = 2 * (C - A);
    const cc = A;
    ts.push(...quadRootsIn01(a, b, cc));
  }
  return ts;
};

/** Tight bounding box of the curve (extrema + endpoints). */
export const bbox = (c: Cubic): Rect => {
  const ts = extrema(c);
  const pts = [c.p0, c.p3, ...ts.map((t) => evaluate(c, t))];
  return fromPoints(pts);
};

/** Split the curve at t into two cubics (de Casteljau). */
export const split = (c: Cubic, t: number): [Cubic, Cubic] => {
  const ab = lerp(c.p0, c.p1, t);
  const bc = lerp(c.p1, c.p2, t);
  const cd = lerp(c.p2, c.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const abcd = lerp(abc, bcd, t);
  return [
    { p0: c.p0, p1: ab, p2: abc, p3: abcd },
    { p0: abcd, p1: bcd, p2: cd, p3: c.p3 },
  ];
};

/** Extract the sub-curve between parameters t0 and t1. */
export const subcurve = (c: Cubic, t0: number, t1: number): Cubic => {
  if (t0 > t1) [t0, t1] = [t1, t0];
  let cc = c;
  if (t0 > 0) cc = split(cc, t0)[1];
  if (t1 < 1) {
    const remap = t0 < 1 ? (t1 - t0) / (1 - t0) : 0;
    cc = split(cc, remap)[0];
  }
  return cc;
};

const isFlat = (c: Cubic, tol: number): boolean => {
  // Distance of control points from the chord p0→p3.
  const ux = 3 * c.p1.x - 2 * c.p0.x - c.p3.x;
  const uy = 3 * c.p1.y - 2 * c.p0.y - c.p3.y;
  const vx = 3 * c.p2.x - c.p0.x - 2 * c.p3.x;
  const vy = 3 * c.p2.y - c.p0.y - 2 * c.p3.y;
  const m = Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
  return m <= 16 * tol * tol;
};

/** Adaptively flatten the curve into points (excluding p0, including p3). */
export const flatten = (c: Cubic, tol = 0.25): Point[] => {
  const out: Point[] = [];
  const recurse = (cc: Cubic, depth: number) => {
    if (depth > 18 || isFlat(cc, tol)) {
      out.push(cc.p3);
      return;
    }
    const [l, r] = split(cc, 0.5);
    recurse(l, depth + 1);
    recurse(r, depth + 1);
  };
  recurse(c, 0);
  return out;
};

/** Arc length via adaptive flattening. */
export const length = (c: Cubic, tol = 0.1): number => {
  const pts = [c.p0, ...flatten(c, tol)];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
};

export interface Projection {
  t: number;
  point: Point;
  dist: number;
}

/** Nearest point on the curve to p (coarse sample + local refine). */
export const project = (c: Cubic, p: Point, samples = 24): Projection => {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const d = dist(evaluate(c, t), p);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  // Refine around the best sample with a shrinking window.
  let lo = Math.max(0, best - 1 / samples);
  let hi = Math.min(1, best + 1 / samples);
  for (let iter = 0; iter < 32; iter++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = dist(evaluate(c, m1), p);
    const d2 = dist(evaluate(c, m2), p);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const point = evaluate(c, t);
  return { t, point, dist: dist(point, p) };
};

/** Build the cubic control points that pass smoothly through a→b given handles. */
export const fromHandles = (
  a: Point,
  aHandleOut: Point,
  b: Point,
  bHandleIn: Point,
): Cubic => ({
  p0: a,
  p1: add(a, aHandleOut),
  p2: add(b, bHandleIn),
  p3: b,
});

/** Offset a flattened polyline approximation — used by stroke/offset ops. */
export const tangentAt = (c: Cubic, t: number): Point => {
  const d = derivative(c, t);
  const l = Math.hypot(d.x, d.y);
  return l < 1e-9 ? { x: 1, y: 0 } : { x: d.x / l, y: d.y / l };
};

export const midScale = scale; // re-export convenience
export const segMid = (c: Cubic): Point => evaluate(c, 0.5);
export const reverse = (c: Cubic): Cubic => ({ p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 });
export { sub as vecSub };
