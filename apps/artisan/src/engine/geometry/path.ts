// ─────────────────────────────────────────────────────────────
// path — anchor-based vector path geometry
// ─────────────────────────────────────────────────────────────
// A path is a list of anchors plus a `closed` flag. Each anchor stores its
// on-curve `point` and two handle vectors expressed as RELATIVE deltas from the
// point (handleIn controls the incoming segment, handleOut the outgoing one).
// Relative handles transform cleanly (they scale/rotate with the linear part of
// a matrix while the point translates).

import * as B from "./bezier";
import { applyToPoint, applyToVector, type Matrix } from "./matrix";
import { add, dist, type Point, sub, ZERO } from "./vec";
import { fromPoints, type Rect, union } from "./bbox";

export interface Anchor {
  point: Point;
  /** Incoming handle, relative to `point`. {0,0} ⇒ corner with no handle. */
  handleIn: Point;
  /** Outgoing handle, relative to `point`. */
  handleOut: Point;
}

export interface PathGeometry {
  anchors: Anchor[];
  closed: boolean;
}

export const anchor = (point: Point, handleIn: Point = ZERO, handleOut: Point = ZERO): Anchor => ({
  point,
  handleIn: { ...handleIn },
  handleOut: { ...handleOut },
});

export const path = (anchors: Anchor[] = [], closed = false): PathGeometry => ({ anchors, closed });

/**
 * Catmull-Rom tangents → cubic handles for a smooth curve running THROUGH the
 * given points (the Pencil's fit, and Illustrator's Curvature tool). Each
 * anchor's tangent is a sixth of the vector between its neighbours; the ends of
 * an open run clamp to themselves, and any index in `corners` becomes a plain
 * corner with no handles.
 */
export const smoothThrough = (pts: Point[], closed = false, corners: ReadonlySet<number> = new Set()): Anchor[] => {
  const n = pts.length;
  return pts.map((p, i) => {
    if (corners.has(i)) return anchor(p);
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t = { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 };
    return anchor(p, { x: -t.x, y: -t.y }, t);
  });
};

const handleIsZero = (h: Point): boolean => Math.abs(h.x) < 1e-9 && Math.abs(h.y) < 1e-9;

/** The cubic segments of the path (one per drawn span; includes the closing span when closed). */
export const segments = (p: PathGeometry): B.Cubic[] => {
  const n = p.anchors.length;
  if (n < 2) return [];
  const out: B.Cubic[] = [];
  const span = (i: number, j: number) => {
    const a = p.anchors[i];
    const b = p.anchors[j];
    out.push(B.fromHandles(a.point, a.handleOut, b.point, b.handleIn));
  };
  for (let i = 0; i < n - 1; i++) span(i, i + 1);
  if (p.closed) span(n - 1, 0);
  return out;
};

/** Build the SVG path `d` attribute. */
export const toSVGPath = (p: PathGeometry): string => {
  const n = p.anchors.length;
  if (n === 0) return "";
  const a0 = p.anchors[0];
  let d = `M ${fmt(a0.point.x)} ${fmt(a0.point.y)}`;
  const span = (from: Anchor, to: Anchor) => {
    if (handleIsZero(from.handleOut) && handleIsZero(to.handleIn)) {
      d += ` L ${fmt(to.point.x)} ${fmt(to.point.y)}`;
    } else {
      const c1 = add(from.point, from.handleOut);
      const c2 = add(to.point, to.handleIn);
      d += ` C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.point.x)} ${fmt(to.point.y)}`;
    }
  };
  for (let i = 0; i < n - 1; i++) span(p.anchors[i], p.anchors[i + 1]);
  if (p.closed && n >= 2) {
    const from = p.anchors[n - 1];
    const to = p.anchors[0];
    // A straight closing segment is implied by Z; only emit a curve explicitly.
    if (!(handleIsZero(from.handleOut) && handleIsZero(to.handleIn))) span(from, to);
    d += " Z";
  }
  return d;
};

const fmt = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Flatten the whole path to a polyline (or polygon when closed). */
export const flatten = (p: PathGeometry, tol = 0.4): Point[] => {
  const segs = segments(p);
  if (segs.length === 0) return p.anchors.map((a) => a.point);
  const pts: Point[] = [segs[0].p0];
  for (const s of segs) pts.push(...B.flatten(s, tol));
  return pts;
};

/** Tight geometric bounding box (curve extrema included). */
export const bounds = (p: PathGeometry): Rect => {
  const segs = segments(p);
  if (segs.length === 0) return fromPoints(p.anchors.map((a) => a.point));
  let r: Rect | null = null;
  for (const s of segs) r = union(r, B.bbox(s));
  return r ?? fromPoints(p.anchors.map((a) => a.point));
};

/** Bounds including handles + anchor points (the "control" bounds). */
export const controlBounds = (p: PathGeometry): Rect => {
  const pts: Point[] = [];
  for (const a of p.anchors) {
    pts.push(a.point, add(a.point, a.handleIn), add(a.point, a.handleOut));
  }
  return fromPoints(pts);
};

export const length = (p: PathGeometry): number => segments(p).reduce((acc, s) => acc + B.length(s), 0);

export interface PathHit {
  segIndex: number;
  t: number;
  point: Point;
  dist: number;
}

/** Nearest point on the outline to `p` (across all segments). */
export const nearest = (p: PathGeometry, target: Point): PathHit | null => {
  const segs = segments(p);
  if (segs.length === 0) return null;
  let best: PathHit | null = null;
  segs.forEach((s, i) => {
    const proj = B.project(s, target);
    if (!best || proj.dist < best.dist) best = { segIndex: i, t: proj.t, point: proj.point, dist: proj.dist };
  });
  return best;
};

/** Is the outline within `tol` of `target`? (stroke hit test) */
export const hitsOutline = (p: PathGeometry, target: Point, tol: number): boolean => {
  const h = nearest(p, target);
  return !!h && h.dist <= tol;
};

/** Winding-number / even-odd fill containment via flattened polygon. */
export const containsPoint = (p: PathGeometry, target: Point, evenOdd = false): boolean => {
  if (p.anchors.length < 3) return false;
  const poly = flatten(p, 0.6);
  let wind = 0;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const intersect = a.y > target.y !== b.y > target.y;
    if (intersect) {
      const xCross = ((b.x - a.x) * (target.y - a.y)) / (b.y - a.y) + a.x;
      if (target.x < xCross) {
        inside = !inside;
        wind += b.y > a.y ? 1 : -1;
      }
    }
  }
  return evenOdd ? inside : wind !== 0;
};

export const transform = (p: PathGeometry, m: Matrix): PathGeometry => ({
  closed: p.closed,
  anchors: p.anchors.map((a) => ({
    point: applyToPoint(m, a.point),
    handleIn: applyToVector(m, a.handleIn),
    handleOut: applyToVector(m, a.handleOut),
  })),
});

export const reverse = (p: PathGeometry): PathGeometry => ({
  closed: p.closed,
  anchors: p.anchors
    .slice()
    .reverse()
    .map((a) => ({ point: a.point, handleIn: a.handleOut, handleOut: a.handleIn })),
});

/** Insert an anchor on the segment at (segIndex, t), splitting the curve cleanly. */
export const insertAnchor = (p: PathGeometry, segIndex: number, t: number): PathGeometry => {
  const segs = segments(p);
  if (segIndex < 0 || segIndex >= segs.length) return p;
  const [l, r] = B.split(segs[segIndex], t);
  const anchors = p.anchors.map((a) => ({ point: { ...a.point }, handleIn: { ...a.handleIn }, handleOut: { ...a.handleOut } }));
  const i = segIndex;
  const j = (segIndex + 1) % anchors.length;
  // Update flanking handles and insert the new on-curve anchor.
  anchors[i].handleOut = sub(l.p1, l.p0);
  anchors[j].handleIn = sub(r.p2, r.p3);
  const mid: Anchor = { point: l.p3, handleIn: sub(l.p2, l.p3), handleOut: sub(r.p1, r.p0) };
  anchors.splice(i + 1, 0, mid);
  return { anchors, closed: p.closed };
};

export const removeAnchor = (p: PathGeometry, index: number): PathGeometry => {
  if (index < 0 || index >= p.anchors.length) return p;
  const anchors = p.anchors.slice();
  anchors.splice(index, 1);
  return { anchors, closed: p.closed && anchors.length >= 2 ? p.closed : false };
};

/** Total polygon signed area (used for winding / pathfinder orientation). */
export const signedArea = (p: PathGeometry): number => {
  const poly = flatten(p, 0.6);
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return a / 2;
};

export const isClockwise = (p: PathGeometry): boolean => signedArea(p) > 0;

/** A coarse perimeter point list for snapping / measurement. */
export const samplePoints = (p: PathGeometry, perSegment = 8): Point[] => {
  const segs = segments(p);
  const out: Point[] = [];
  segs.forEach((s) => {
    for (let i = 0; i < perSegment; i++) out.push(B.evaluate(s, i / perSegment));
  });
  if (!p.closed && segs.length) out.push(segs[segs.length - 1].p3);
  return out;
};

export const distanceToPoint = (p: PathGeometry, target: Point): number => {
  const h = nearest(p, target);
  return h ? h.dist : Infinity;
};

/**
 * Build a variable-width stroke outline (a ribbon) for a path: the centerline is
 * offset by ±width/2 along its normals, where width interpolates between the
 * per-anchor multipliers. Returns closed subpaths (outer + inner for closed
 * paths, one ring for open). Used by the Width tool's renderer.
 */
export const widthOutline = (p: PathGeometry, multipliers: number[], baseWidth: number): PathGeometry[] => {
  const segs = segments(p);
  if (segs.length === 0) return [];
  const n = p.anchors.length;
  const mAt = (i: number) => multipliers[((i % n) + n) % n] ?? 1;
  const samples: { pt: Point; w: number }[] = [];
  segs.forEach((s, si) => {
    const flat = [s.p0, ...B.flatten(s, 0.6)];
    const w0 = baseWidth * mAt(si);
    const w1 = baseWidth * mAt(si + 1);
    for (let k = 0; k < flat.length; k++) {
      // skip duplicate seam points (each segment repeats the previous endpoint)
      if (si > 0 && k === 0) continue;
      const t = flat.length > 1 ? k / (flat.length - 1) : 0;
      samples.push({ pt: flat[k], w: w0 + (w1 - w0) * t });
    }
  });
  // Closed paths end on the same point they start on. Keep one seam sample and
  // wrap its neighbours so it gets the same averaged normal as every corner.
  if (p.closed && samples.length > 2 && dist(samples[0].pt, samples[samples.length - 1].pt) < 1e-6) samples.pop();
  const m = samples.length;
  if (m < 2) return [];
  const normalAt = (i: number): Point => {
    const a = samples[i === 0 && p.closed ? m - 1 : Math.max(0, i - 1)].pt;
    const b = samples[i === m - 1 && p.closed ? 0 : Math.min(m - 1, i + 1)].pt;
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const L = Math.hypot(tx, ty) || 1;
    return { x: -ty / L, y: tx / L };
  };
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < m; i++) {
    const nm = normalAt(i);
    const hw = samples[i].w / 2;
    left.push({ x: samples[i].pt.x + nm.x * hw, y: samples[i].pt.y + nm.y * hw });
    right.push({ x: samples[i].pt.x - nm.x * hw, y: samples[i].pt.y - nm.y * hw });
  }
  const ring = (pts: Point[]): PathGeometry => ({ closed: true, anchors: pts.map((pt) => anchor(pt)) });
  if (p.closed) return [ring(left), ring(right.reverse())];
  return [ring([...left, ...right.reverse()])];
};

/** Variable-width ribbons for a path or compound's flat per-anchor profile. */
export const widthOutlines = (paths: PathGeometry[], multipliers: number[], baseWidth: number): PathGeometry[] => {
  let offset = 0;
  return paths.flatMap((path) => {
    const profile = multipliers.slice(offset, offset + path.anchors.length);
    offset += path.anchors.length;
    return widthOutline(path, profile, baseWidth);
  });
};

export { dist as pointDist };
