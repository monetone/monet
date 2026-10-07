// ─────────────────────────────────────────────────────────────
// ops/round-corners — Object ▸ Path ▸ Round Corners (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Round Corners (Effect ▸ Stylize ▸ Round Corners) replaces
// every SHARP corner of a path with a circular-arc fillet of a given radius.
// Each corner anchor becomes two anchors set back along the adjacent edges by the
// radius, joined by a bezier that approximates the quarter-circle (KAPPA handles —
// the same construction the live shapes use for rounded rectangles). Smooth
// anchors and an open path's endpoints are left untouched; the radius is clamped
// to half of each adjacent edge so neighbouring fillets never overlap.

import { type Point, add, dist, normalize, scale, sub } from "../geometry/vec";
import { type Anchor, type PathGeometry } from "../geometry/path";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

const isCorner = (a: Anchor): boolean =>
  !(a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y);

const copy = (a: Anchor): Anchor => ({
  point: { ...a.point },
  handleIn: { ...a.handleIn },
  handleOut: { ...a.handleOut },
});

/** Round the sharp corners of one subpath; returns a new geometry. */
export const roundGeometry = (g: PathGeometry, radius: number): PathGeometry => {
  const n = g.anchors.length;
  if (n < 3 || radius <= 0) return g;
  const out: Anchor[] = [];
  for (let i = 0; i < n; i++) {
    const a = g.anchors[i];
    const endpoint = !g.closed && (i === 0 || i === n - 1);
    if (endpoint || !isCorner(a)) {
      out.push(copy(a));
      continue;
    }
    const cur = a.point;
    const prev = g.anchors[(i - 1 + n) % n].point;
    const next = g.anchors[(i + 1) % n].point;
    const lenPrev = dist(prev, cur);
    const lenNext = dist(next, cur);
    if (lenPrev < 1e-9 || lenNext < 1e-9) {
      out.push(copy(a));
      continue;
    }
    const v1 = normalize(sub(prev, cur));
    const v2 = normalize(sub(next, cur));
    const theta = Math.acos(Math.max(-1, Math.min(1, v1.x * v2.x + v1.y * v2.y)));
    const sweep = Math.PI - theta;
    if (theta < 1e-6 || sweep < 1e-6) {
      out.push(copy(a));
      continue;
    }
    const setback = Math.min(radius / Math.tan(theta / 2), lenPrev / 2, lenNext / 2);
    const actualRadius = setback * Math.tan(theta / 2);
    const handle = (4 / 3) * Math.tan(sweep / 4) * actualRadius;
    const p1 = add(cur, scale(v1, setback)); // back along incoming edge
    const p2 = add(cur, scale(v2, setback)); // forward along outgoing edge
    const ZERO: Point = { x: 0, y: 0 };
    // Handles follow the incident edges; their length matches this corner's arc sweep.
    out.push({ point: p1, handleIn: { ...ZERO }, handleOut: scale(normalize(sub(cur, p1)), handle) });
    out.push({ point: p2, handleIn: scale(normalize(sub(cur, p2)), handle), handleOut: { ...ZERO } });
  }
  return { closed: g.closed, anchors: out };
};

/**
 * Object ▸ Path ▸ Round Corners — round the corners of each selected path,
 * compound path or live shape (shapes are converted to paths first). Smooth
 * curves are preserved. Mutates in place; returns the ids it modified.
 */
export const roundCorners = (doc: Document, ids: ID[], radius: number): ID[] => {
  if (radius <= 0) return [];
  const done: ID[] = [];
  for (const id of leafIds(doc, ids)) {
    let loc = findItem(doc, id);
    if (!loc) continue;
    if (LIVE_SHAPES.includes(loc.item.type)) {
      convertToPath(doc, id);
      loc = findItem(doc, id);
      if (!loc) continue;
    }
    const it = loc.item;
    if (it.type === "path") {
      it.geometry = roundGeometry(it.geometry, radius);
      done.push(id);
    } else if (it.type === "compound") {
      it.subpaths = it.subpaths.map((sp) => roundGeometry(sp, radius));
      done.push(id);
    }
  }
  return done;
};
