// ─────────────────────────────────────────────────────────────
// ops/pucker-bloat — Effect ▸ Distort & Transform ▸ Pucker & Bloat (parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Pucker & Bloat effect (NOT the liquify brush tools) curves
// a path's edges relative to its centre. Each anchor point keeps its position but
// its two bezier handles are set radially: handleIn = handleOut = amount·(P − C),
// where C is the object's bounding-box centre. A positive amount (Bloat) makes
// the handles point AWAY from the centre, so segments bulge outward; a negative
// amount (Pucker) points them toward the centre, caving the segments in and
// turning the anchors into spikes.

import { add, type Point, scale, sub } from "../geometry/vec";
import { bounds as pathBounds, type PathGeometry } from "../geometry/path";
import { type Rect, union } from "../geometry/bbox";
import { localPaths } from "../model/shapes";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

const puckerGeometry = (g: PathGeometry, center: Point, amount: number): PathGeometry => ({
  closed: g.closed,
  anchors: g.anchors.map((a) => {
    const v = scale(sub(a.point, center), amount);
    const keep = 1 - Math.min(1, Math.abs(amount));
    return {
      point: { ...a.point },
      handleIn: add(scale(a.handleIn, keep), v),
      handleOut: add(scale(a.handleOut, keep), v),
    };
  }),
});

/**
 * Effect ▸ Distort & Transform ▸ Pucker & Bloat — set radial handles on each
 * selected path / compound / live shape. `amount` > 0 bloats, < 0 puckers (a
 * fraction, where ±1 ≈ Illustrator's ±100%). Mutates in place; returns the ids.
 */
export const puckerBloat = (doc: Document, ids: ID[], amount: number): ID[] => {
  if (!amount) return []; // zero amount is a no-op
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
    const paths = localPaths(it);
    if (paths.length === 0) continue;

    let r: Rect | null = null;
    for (const p of paths) r = union(r, pathBounds(p));
    if (!r) continue;
    const center: Point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };

    if (it.type === "path") {
      it.geometry = puckerGeometry(it.geometry, center, amount);
      done.push(id);
    } else if (it.type === "compound") {
      it.subpaths = it.subpaths.map((sp) => puckerGeometry(sp, center, amount));
      done.push(id);
    }
  }
  return done;
};
