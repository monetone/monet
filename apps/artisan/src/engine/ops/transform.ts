// ─────────────────────────────────────────────────────────────
// ops/transform — apply world-space transforms to items
// ─────────────────────────────────────────────────────────────
// An item's `transform` maps local→parent. To apply a world-space matrix W to
// an item we conjugate by the parent's world transform P:
//     newLocal = P⁻¹ · W · P · oldLocal

import {
  aroundPoint,
  type Matrix,
  invert,
  mul,
  rotation,
  scaling,
  shearing,
  translation,
} from "../geometry/matrix";
import type { Point } from "../geometry/vec";
import { findItem, parentTransform } from "../model/query";
import type { Document, ID } from "../model/types";

export const transformItems = (doc: Document, ids: Iterable<ID>, world: Matrix): void => {
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const P = parentTransform(loc.ancestors);
    const local = mul(mul(mul(invert(P), world), P), loc.item.transform);
    loc.item.transform = local;
  }
};

export const translateItems = (doc: Document, ids: Iterable<ID>, dx: number, dy: number): void =>
  transformItems(doc, ids, translation(dx, dy));

export const rotateItems = (doc: Document, ids: Iterable<ID>, rad: number, pivot: Point): void =>
  transformItems(doc, ids, aroundPoint(pivot, rotation(rad)));

export const scaleItems = (
  doc: Document,
  ids: Iterable<ID>,
  sx: number,
  sy: number,
  pivot: Point,
): void => transformItems(doc, ids, aroundPoint(pivot, scaling(sx, sy)));

export const shearItems = (
  doc: Document,
  ids: Iterable<ID>,
  radX: number,
  radY: number,
  pivot: Point,
): void => transformItems(doc, ids, aroundPoint(pivot, shearing(radX, radY)));

/** Reflect across a line through `pivot` at `angle` radians. */
export const reflectItems = (doc: Document, ids: Iterable<ID>, angle: number, pivot: Point): void => {
  const c = Math.cos(2 * angle);
  const s = Math.sin(2 * angle);
  const reflect: Matrix = { a: c, b: s, c: s, d: -c, e: 0, f: 0 };
  transformItems(doc, ids, aroundPoint(pivot, reflect));
};

export { aroundPoint, rotation, scaling, shearing, translation };
