// ─────────────────────────────────────────────────────────────
// geometry/offset — constant-distance polygon offsetting (Offset Path)
// ─────────────────────────────────────────────────────────────
// The geometry behind Illustrator's Object ▸ Path ▸ Offset Path: move every
// edge of a polygon perpendicular by a fixed distance (positive ⇒ outward /
// grow, negative ⇒ inward / shrink) and reconnect the offset edges at each
// corner with a MITER (sharp), ROUND (arc) or BEVEL (flat) join. The miter
// limit converts an over-long miter spike into a bevel, exactly like the
// Offset Path dialog's Miter limit field.
//
// PURE math — operates on plain Point[] polygons. Curves are flattened to
// polygons by the caller (ops/offset-path); open paths are handled there too.

import { type Point, cross, dot, normalize } from "./vec";

export type OffsetJoin = "miter" | "round" | "bevel";

export interface OffsetOptions {
  /** Signed distance: + grows (outward), − shrinks (inward). */
  distance: number;
  /** Corner treatment. Default "miter" (Illustrator's default). */
  join?: OffsetJoin;
  /** Miter→bevel cutoff ratio. Default 4 (the Offset Path dialog default). */
  miterLimit?: number;
}

/** Trapezoidal signed area (same sign convention as geometry/path.signedArea:
 *  > 0 ⇒ clockwise in screen coordinates, where y points down). */
const signedArea = (poly: Point[]): number => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return a / 2;
};

/**
 * Normalise a polygon for offsetting: drop consecutive duplicate points
 * (including the closing wrap-around) and collinear vertices, so a rectangle
 * flattened into many edge points collapses back to its 4 real corners.
 */
export const cleanPolygon = (poly: Point[], eps = 1e-6): Point[] => {
  const pts: Point[] = [];
  for (const p of poly) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) pts.push({ x: p.x, y: p.y });
  }
  while (pts.length >= 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= eps) pts.pop();
  if (pts.length < 3) return pts;

  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const e1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const e2 = { x: next.x - cur.x, y: next.y - cur.y };
    const turn = e1.x * e2.y - e1.y * e2.x;
    const lenProd = Math.hypot(e1.x, e1.y) * Math.hypot(e2.x, e2.y);
    if (lenProd < eps || Math.abs(turn) > eps * lenProd) out.push(cur); // keep real corners
  }
  return out.length >= 3 ? out : pts;
};

/** Outward unit normal of an edge with unit direction `dir`, given the polygon's
 *  orientation scalar `o` (see offsetPolygon): the outward side is (o·dir.y, −o·dir.x). */
const outwardNormal = (dir: Point, o: number): Point => ({ x: o * dir.y, y: -o * dir.x });

/** Append the interior points of the arc from A to B around `center` (radius r),
 *  taking the short way (|sweep| ≤ π). Endpoints A and B are NOT pushed. */
const pushArc = (out: Point[], center: Point, a: Point, b: Point, r: number): void => {
  const a0 = Math.atan2(a.y - center.y, a.x - center.x);
  let delta = Math.atan2(b.y - center.y, b.x - center.x) - a0;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 8))); // ≤ 22.5° per chord
  for (let i = 1; i < steps; i++) {
    const ang = a0 + (delta * i) / steps;
    out.push({ x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang) });
  }
};

/** Emit the offset vertex/vertices for the corner at `cur` between the incoming
 *  edge (prev→cur) and outgoing edge (cur→next). */
const emitJoin = (
  out: Point[],
  prev: Point,
  cur: Point,
  next: Point,
  d: number,
  o: number,
  join: OffsetJoin,
  miterLimit: number,
): void => {
  const eIn = normalize({ x: cur.x - prev.x, y: cur.y - prev.y });
  const eOut = normalize({ x: next.x - cur.x, y: next.y - cur.y });
  const nIn = outwardNormal(eIn, o);
  const nOut = outwardNormal(eOut, o);
  const a = { x: cur.x + d * nIn.x, y: cur.y + d * nIn.y }; // end of offset incoming edge
  const b = { x: cur.x + d * nOut.x, y: cur.y + d * nOut.y }; // start of offset outgoing edge
  const c = dot(nIn, nOut); // cos(angle between the two outward normals)
  const convex = cross(eIn, eOut) * o > 0; // corner turns toward the outside
  const gap = convex === d > 0; // material is ADDED on the offset side here

  // The non-gap side always uses the single miter-intersection point (it tucks
  // the corner in); the gap side uses it too when the join is "miter".
  if (!gap || join === "miter") {
    if (c <= -0.999999) {
      out.push(a, b); // 180° spike — miter shoots to infinity, fall back to bevel
      return;
    }
    const k = d / (1 + c);
    const miter = { x: cur.x + k * (nIn.x + nOut.x), y: cur.y + k * (nIn.y + nOut.y) };
    if (gap && join === "miter") {
      const ratio = Math.hypot(miter.x - cur.x, miter.y - cur.y) / Math.abs(d);
      if (ratio > miterLimit) {
        out.push(a, b); // miter too long → bevel (Miter limit)
        return;
      }
    }
    out.push(miter);
    return;
  }

  if (join === "bevel") {
    out.push(a, b);
    return;
  }
  // round
  out.push(a);
  pushArc(out, cur, a, b, Math.abs(d));
  out.push(b);
};

/**
 * Offset a CLOSED polygon by `distance`, returning the offset polygon's points.
 * Returns < 3 points (or an empty list) when the shape collapses; callers should
 * treat that as "nothing to draw".
 */
export const offsetPolygon = (poly: Point[], opts: OffsetOptions): Point[] => {
  const { distance } = opts;
  const join = opts.join ?? "miter";
  const miterLimit = opts.miterLimit ?? 4;
  const clean = cleanPolygon(poly);
  if (clean.length < 3) return clean.map((p) => ({ x: p.x, y: p.y }));
  if (distance === 0) return clean.map((p) => ({ x: p.x, y: p.y }));

  // Orientation scalar `o`: chosen so a positive distance always grows the shape
  // (moves edges OUTWARD) and a negative one shrinks it, independent of the
  // path's winding direction. signedArea uses screen coordinates (y down).
  const o = signedArea(clean) > 0 ? -1 : 1;
  const n = clean.length;
  const out: Point[] = [];
  const joins: { first: Point; last: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const start = out.length;
    emitJoin(out, clean[(i - 1 + n) % n], clean[i], clean[(i + 1) % n], distance, o, join, miterLimit);
    joins.push({ first: out[start], last: out[out.length - 1] });
  }
  if (distance < 0) {
    // Once an inset consumes an edge, adjacent joins reverse along that edge;
    // returning the re-grown polygon would turn a collapsed shape into artwork.
    for (let i = 0; i < n; i++) {
      const edge = { x: clean[(i + 1) % n].x - clean[i].x, y: clean[(i + 1) % n].y - clean[i].y };
      const offsetEdge = { x: joins[(i + 1) % n].first.x - joins[i].last.x, y: joins[(i + 1) % n].first.y - joins[i].last.y };
      if (dot(edge, offsetEdge) <= 1e-9) return [];
    }
    if (signedArea(clean) * signedArea(out) <= 0) return [];
  }
  return out;
};
