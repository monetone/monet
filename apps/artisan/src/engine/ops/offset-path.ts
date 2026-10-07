// ─────────────────────────────────────────────────────────────
// ops/offset-path — Object ▸ Path ▸ Offset Path (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Creates a NEW path offset from each selected object by a fixed distance
// (positive ⇒ outward, negative ⇒ inward), joining corners with miter / round /
// bevel and respecting a miter limit. The original object is kept; the offset
// copy is inserted directly above it (and becomes the selection). Closed paths
// and live shapes grow/shrink; an open path offsets into a closed outline band
// at ±|distance| (as Illustrator does). Groups / text / images are skipped.

import { type PathGeometry, anchor, flatten, widthOutline } from "../geometry/path";
import type { Point } from "../geometry/vec";
import { type OffsetJoin, offsetPolygon } from "../geometry/offset";
import { findItem } from "../model/query";
import { localPaths } from "../model/shapes";
import { carryItemState, makeCompound, makePath } from "../model/factory";
import type { Document, ID, Item } from "../model/types";
import { geometryMultiPolygon, regionToSubpaths, unionRegion } from "./pathfinder";
import { leafIds } from "./path-edit";

export interface OffsetPathOptions {
  /** Signed offset distance: + grows (outward), − shrinks (inward). */
  distance: number;
  /** Corner join. Default "miter". */
  join?: OffsetJoin;
  /** Miter→bevel cutoff ratio. Default 4 (Illustrator's Offset Path default). */
  miterLimit?: number;
}

type ResolvedOptions = Required<OffsetPathOptions>;

const isCurved = (g: PathGeometry): boolean =>
  g.anchors.some((a) => a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y);

/** A polygon approximation of a subpath: exact corner points for straight-edged
 *  paths, flattened curve samples otherwise. */
const polygonOf = (g: PathGeometry): Point[] =>
  isCurved(g) ? flatten(g, 0.25) : g.anchors.map((a) => ({ x: a.point.x, y: a.point.y }));

/** Offset a single subpath. Closed ⇒ the grown/shrunk polygon; open ⇒ a closed
 *  constant-width outline band at ±|distance|. Returns [] if it collapses. */
const offsetSubpath = (g: PathGeometry, opts: ResolvedOptions): PathGeometry[] => {
  if (g.anchors.length < 2) return [];
  if (!g.closed) {
    return widthOutline(g, new Array(g.anchors.length).fill(1), Math.abs(opts.distance) * 2);
  }
  const pts = offsetPolygon(polygonOf(g), opts);
  if (pts.length < 3) return [];
  const raw = { closed: true, anchors: pts.map((p) => anchor(p)) };
  return regionToSubpaths(unionRegion(geometryMultiPolygon([raw])));
};

export const offsetPath = (doc: Document, ids: ID[], options: OffsetPathOptions): ID[] => {
  const opts: ResolvedOptions = {
    distance: options.distance,
    join: options.join ?? "miter",
    miterLimit: options.miterLimit ?? 4,
  };
  const newIds: ID[] = [];
  if (!opts.distance) return newIds; // a zero offset is a no-op

  for (const id of leafIds(doc, ids)) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const item = loc.item;
    const geos = localPaths(item);
    if (geos.length === 0) continue; // group / text / image carry no path geometry

    const offsetGeos: PathGeometry[] = [];
    for (const g of geos) offsetGeos.push(...offsetSubpath(g, opts));
    if (offsetGeos.length === 0) continue;

    const next: Item = carryItemState(
      offsetGeos.length === 1 ? makePath(offsetGeos[0]) : makeCompound(offsetGeos),
      item,
    );
    next.transform = { ...item.transform };

    // Insert the offset copy just ABOVE the original (Illustrator keeps the source).
    loc.container.splice(loc.index + 1, 0, next);
    newIds.push(next.id);
  }
  return newIds;
};
