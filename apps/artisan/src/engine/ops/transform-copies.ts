// ─────────────────────────────────────────────────────────────
// ops/transform-copies — Effect ▸ Distort & Transform ▸ Transform (parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Transform effect applies a scale / rotate / move (+ reflect)
// to an object AND, via its "Copies" field, stamps that many extra copies — each
// the previous one transformed again. With a rotate it fans copies into a ring;
// with a move it steps them into a row; with both it spirals. Rotation/scaling
// happen around a chosen 9-point reference on the object's bounding box.
//
// This bakes the result: the original plus the copies are wrapped in one group.

import { IDENTITY, type Matrix, aroundPoint, invert, mul, rotation, scaling, translation } from "../geometry/matrix";
import type { Rect } from "../geometry/bbox";
import type { Point } from "../geometry/vec";
import { cloneItemDeep } from "./items";
import { findItem, parentTransform, worldBounds } from "../model/query";
import { makeGroup } from "../model/factory";
import type { Document, ID, Item } from "../model/types";

export type Reference =
  | "center"
  | "top-left" | "top" | "top-right"
  | "left" | "right"
  | "bottom-left" | "bottom" | "bottom-right";

export interface TransformCopiesOptions {
  scaleX?: number;
  scaleY?: number;
  /** Rotation per step, radians. */
  rotate?: number;
  moveX?: number;
  moveY?: number;
  reflectX?: boolean;
  reflectY?: boolean;
  /** Pivot for scale/rotate on each object's bounding box. Default "center". */
  reference?: Reference;
  /** Extra copies to stamp (≥1). Total objects = copies + 1. */
  copies: number;
}

const refPoint = (b: Rect, ref: Reference): Point => {
  const fx = ref.includes("left") ? 0 : ref.includes("right") ? 1 : 0.5;
  const fy = ref.includes("top") ? 0 : ref.includes("bottom") ? 1 : 0.5;
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};

export const transformCopies = (doc: Document, ids: ID[], opts: TransformCopiesOptions): ID[] => {
  const copies = Math.max(1, Math.floor(opts.copies));
  const sx = (opts.scaleX ?? 1) * (opts.reflectX ? -1 : 1);
  const sy = (opts.scaleY ?? 1) * (opts.reflectY ? -1 : 1);
  const rot = opts.rotate ?? 0;
  const mx = opts.moveX ?? 0;
  const my = opts.moveY ?? 0;
  const reference = opts.reference ?? "center";

  const newIds: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const b = worldBounds(doc, id);
    if (!b) continue;

    // Per-step WORLD transform: scale+rotate around the reference point, then move.
    const pivot = refPoint(b, reference);
    const step = mul(translation(mx, my), aroundPoint(pivot, mul(rotation(rot), scaling(sx, sy))));
    const P = parentTransform(loc.ancestors);
    const Pinv = invert(P);

    const children: Item[] = [loc.item]; // original becomes the group's base copy
    let acc: Matrix = IDENTITY;
    for (let k = 1; k <= copies; k++) {
      acc = mul(step, acc); // acc = step^k, in world space
      const clone = cloneItemDeep(loc.item);
      // Apply the world transform to the clone: local' = P⁻¹ · acc · P · local.
      clone.transform = mul(mul(mul(Pinv, acc), P), loc.item.transform);
      children.push(clone);
    }

    const group = makeGroup(children, { name: loc.item.name });
    loc.container.splice(loc.index, 1, group); // replace original in place (keeps its z)
    newIds.push(group.id);
  }
  return newIds;
};
