// ─────────────────────────────────────────────────────────────
// ops/simplify — Object ▸ Path ▸ Simplify (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Simplify reduces the number of anchor points on a path
// while keeping its shape. This removes anchors whose perpendicular distance to
// the straight line between their two neighbours is within `tolerance` — a higher
// tolerance removes more points. Points are dropped one at a time, always the
// flattest first, so redundant collinear / near-collinear points go before real
// corners. An open path keeps its endpoints; a closed path keeps at least three
// anchors. Retained anchors keep their bezier handles.

import { type Point, cross, dist, len, sub } from "../geometry/vec";
import type { PathGeometry } from "../geometry/path";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

export interface SimplifyOptions {
  /** Max distance (user units) a point may sit from the line between its
   *  neighbours and still be removed. Higher ⇒ fewer points. */
  tolerance: number;
}

/** Perpendicular distance from `p` to the infinite line through a→b. */
const perpDist = (p: Point, a: Point, b: Point): number => {
  const ab = sub(b, a);
  const L = len(ab);
  if (L < 1e-12) return dist(p, a);
  return Math.abs(cross(ab, sub(p, a))) / L;
};

const simplifyGeometry = (g: PathGeometry, tol: number): PathGeometry => {
  const anchors = g.anchors.map((a) => ({
    point: { ...a.point },
    handleIn: { ...a.handleIn },
    handleOut: { ...a.handleOut },
  }));
  if (tol <= 0) return { closed: g.closed, anchors };
  const minCount = g.closed ? 3 : 2;

  while (anchors.length > minCount) {
    const n = anchors.length;
    const lo = g.closed ? 0 : 1; // open paths keep their endpoints
    const hi = g.closed ? n : n - 1;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = lo; i < hi; i++) {
      const prev = anchors[(i - 1 + n) % n];
      const cur = anchors[i];
      const next = anchors[(i + 1) % n];
      if ([prev, cur, next].some((a) => a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y)) continue;
      const d = perpDist(cur.point, prev.point, next.point);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist > tol) break;
    anchors.splice(bestIdx, 1);
  }
  return { closed: g.closed, anchors };
};

/**
 * Object ▸ Path ▸ Simplify — reduce anchor count on each selected path / compound
 * / live shape within `tolerance`. Mutates in place; returns the ids it touched.
 */
export const simplify = (doc: Document, ids: ID[], opts: SimplifyOptions): ID[] => {
  const tol = Math.max(0, opts.tolerance);
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
      it.geometry = simplifyGeometry(it.geometry, tol);
      done.push(id);
    } else if (it.type === "compound") {
      it.subpaths = it.subpaths.map((sp) => simplifyGeometry(sp, tol));
      done.push(id);
    }
  }
  return done;
};
