// ─────────────────────────────────────────────────────────────
// ops/twist — Effect ▸ Distort & Transform ▸ Twist (parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Twist effect rotates an object around its centre "more
// sharply in the centre than at the edges". We model that as a continuous whirl
// field: every point is rotated around the object's bounding-box centre by an
// angle that tapers linearly with radius — the full `angle` at the centre, down
// to 0 at the farthest anchor (the rim). Anchor points AND their bezier handle
// endpoints are rotated by the field value at their own location, so curved
// segments spiral with the shape.

import { type Point, rotate, rotateAround } from "../geometry/vec";
import { bounds as pathBounds, type PathGeometry } from "../geometry/path";
import { type Rect, union } from "../geometry/bbox";
import { localPaths } from "../model/shapes";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

const twistGeometry = (g: PathGeometry, center: Point, maxR: number, angle: number): PathGeometry => ({
  closed: g.closed,
  anchors: g.anchors.map((a) => {
    // The field angle at THIS anchor. r ≤ 1 since maxR is the farthest anchor, so
    // it never goes negative.
    const theta = angle * (1 - Math.hypot(a.point.x - center.x, a.point.y - center.y) / maxR);
    return {
      ...a,
      point: rotateAround(a.point, center, theta),
      // Rotate the tangent handles rigidly WITH the anchor (by the anchor's field
      // angle), so a smooth point stays smooth. Rotating each handle endpoint by
      // its OWN radius would break tangent continuity — and handle endpoints past
      // maxR (e.g. an ellipse's KAPPA controls) would even counter-rotate.
      handleIn: rotate(a.handleIn, theta),
      handleOut: rotate(a.handleOut, theta),
    };
  }),
});

/**
 * Effect ▸ Distort & Transform ▸ Twist — whirl each selected path / compound /
 * live shape around its centre, rotating the interior more than the rim. `angle`
 * is in radians (positive follows the engine's rotateAround direction). Mutates
 * in place; returns the ids actually modified.
 */
export const twist = (doc: Document, ids: ID[], angle: number): ID[] => {
  if (!angle) return []; // a zero twist leaves every path unchanged
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
    let maxR = 0;
    for (const p of paths) for (const a of p.anchors) maxR = Math.max(maxR, Math.hypot(a.point.x - center.x, a.point.y - center.y));
    if (maxR < 1e-9) continue; // a degenerate (zero-size / single-point) shape can't be twisted

    const apply = (g: PathGeometry): PathGeometry => twistGeometry(g, center, maxR, angle);
    if (it.type === "path") {
      it.geometry = apply(it.geometry);
      done.push(id);
    } else if (it.type === "compound") {
      it.subpaths = it.subpaths.map(apply);
      done.push(id);
    }
  }
  return done;
};
