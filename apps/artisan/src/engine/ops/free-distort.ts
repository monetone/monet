// ─────────────────────────────────────────────────────────────
// ops/free-distort — Effect ▸ Distort & Transform ▸ Free Distort (parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Free Distort reshapes an object by letting you drag its
// four bounding-box CORNER points freely. Internally the object's tight bounding
// box is mapped onto the new quadrilateral by *bilinear interpolation*: every
// point gets normalized coords (u,v) ∈ [0,1] within the bbox, then lands at
//   M(u,v) = (1−u)(1−v)·TL + u(1−v)·TR + u·v·BR + (1−u)·v·BL
// (the four corners spanning the destination quad). Identity corners — the unit
// square (0,0)/(1,0)/(1,1)/(0,1) — leave the object unchanged.
//
// Bezier handles are tangent vectors, so they ride the *local linear* part of
// the map: the 2×2 Jacobian of M at the anchor's (u,v). Using one linear map for
// both endpoints of a handle pair keeps a smooth anchor (handleIn = −handleOut)
// smooth — a per-endpoint remap would kink it. Ref:
// helpx.adobe.com/illustrator/using/reshaping-objects-effects (Free Distort) and
// /illustrator/desktop/manage-objects/reshape-transform-objects/distort-objects.

import { type Point } from "../geometry/vec";
import { bounds as pathBounds, type PathGeometry } from "../geometry/path";
import { type Rect, union } from "../geometry/bbox";
import { localPaths } from "../model/shapes";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

/**
 * The four destination corners, in NORMALIZED unit-square coordinates relative
 * to the object's tight bounding box. Identity (no distortion) is
 * `{ topLeft:(0,0), topRight:(1,0), bottomRight:(1,1), bottomLeft:(0,1) }`.
 * Move a corner past 0..1 to push that corner outside the original box.
 */
export interface FreeDistortCorners {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

const isIdentity = (c: FreeDistortCorners): boolean => {
  const eq = (p: Point, x: number, y: number) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;
  return eq(c.topLeft, 0, 0) && eq(c.topRight, 1, 0) && eq(c.bottomRight, 1, 1) && eq(c.bottomLeft, 0, 1);
};

// Bilinear interpolation of the four (unit-square) corners at parameters (u,v).
const bilerp = (c: FreeDistortCorners, u: number, v: number): Point => {
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const d = u * v;
  const e = (1 - u) * v;
  return {
    x: a * c.topLeft.x + b * c.topRight.x + d * c.bottomRight.x + e * c.bottomLeft.x,
    y: a * c.topLeft.y + b * c.topRight.y + d * c.bottomRight.y + e * c.bottomLeft.y,
  };
};

const distortGeometry = (g: PathGeometry, r: Rect, c: FreeDistortCorners): PathGeometry => ({
  closed: g.closed,
  anchors: g.anchors.map((an) => {
    const u = (an.point.x - r.x) / r.width;
    const v = (an.point.y - r.y) / r.height;

    // New world position: map the unit-square result back through the bbox.
    const m = bilerp(c, u, v);
    const point: Point = { x: r.x + m.x * r.width, y: r.y + m.y * r.height };

    // Jacobian of M at (u,v), in unit-dest space:
    //   ∂M/∂u = (1−v)(TR−TL) + v(BR−BL)
    //   ∂M/∂v = (1−u)(BL−TL) + u(BR−TR)
    const duX = (1 - v) * (c.topRight.x - c.topLeft.x) + v * (c.bottomRight.x - c.bottomLeft.x);
    const duY = (1 - v) * (c.topRight.y - c.topLeft.y) + v * (c.bottomRight.y - c.bottomLeft.y);
    const dvX = (1 - u) * (c.bottomLeft.x - c.topLeft.x) + u * (c.bottomRight.x - c.topRight.x);
    const dvY = (1 - u) * (c.bottomLeft.y - c.topLeft.y) + u * (c.bottomRight.y - c.topRight.y);

    // A world handle (hx,hy) is a step (du,dv) = (hx/w, hy/h) in unit space; map
    // it through the Jacobian, then scale unit-dest back to world by (·w, ·h).
    const w = r.width;
    const h = r.height;
    const mapHandle = (hd: Point): Point => ({
      x: w * (duX * (hd.x / w) + dvX * (hd.y / h)),
      y: h * (duY * (hd.x / w) + dvY * (hd.y / h)),
    });

    return { ...an, point, handleIn: mapHandle(an.handleIn), handleOut: mapHandle(an.handleOut) };
  }),
});

/**
 * Effect ▸ Distort & Transform ▸ Free Distort — bilinearly remap each selected
 * path / compound / live shape from its tight bounding box onto the quadrilateral
 * given by `corners` (normalized unit-square positions, see `FreeDistortCorners`).
 * Identity corners are a no-op. Mutates in place; returns the ids actually moved.
 */
export const freeDistort = (doc: Document, ids: ID[], corners: FreeDistortCorners): ID[] => {
  if (isIdentity(corners)) return []; // an identity quad leaves every path unchanged
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
    if (!r || r.width < 1e-9 || r.height < 1e-9) continue; // a zero-area bbox can't be normalized

    const rect = r;
    const apply = (g: PathGeometry): PathGeometry => distortGeometry(g, rect, corners);
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
