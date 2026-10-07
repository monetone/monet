// ─────────────────────────────────────────────────────────────
// ops/convert-shape — Object ▸ Convert to Shape (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Convert to Shape (Effect ▸ Convert to Shape ▸ Rectangle /
// Rounded Rectangle / Ellipse) replaces each selected object with a primitive
// shape sized to the object's bounding box. "Relative" sizing adds Extra Width /
// Extra Height to those bounds; a corner radius rounds the rectangle variant. The
// new shape is centred on the original's bounds and inherits its fill / stroke /
// transform / opacity.

import { mul, translation } from "../geometry/matrix";
import { localBounds } from "../model/shapes";
import { findItem } from "../model/query";
import { carryItemState, makeEllipse, makeRect } from "../model/factory";
import type { Document, ID, Item } from "../model/types";

export type ShapeKind = "rectangle" | "rounded-rectangle" | "ellipse";

export interface ConvertToShapeOptions {
  /** Extra width added to the object's bounds (Relative sizing). Default 0. */
  extraWidth?: number;
  /** Extra height added to the object's bounds (Relative sizing). Default 0. */
  extraHeight?: number;
  /** Corner radius for the rounded-rectangle variant. Default 12. */
  cornerRadius?: number;
}

export const convertToShape = (doc: Document, ids: ID[], shape: ShapeKind, opts: ConvertToShapeOptions = {}): ID[] => {
  const ew = opts.extraWidth ?? 0;
  const eh = opts.extraHeight ?? 0;
  const done: ID[] = [];

  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const item = loc.item;
    const b = localBounds(item);
    const w = b.width + ew;
    const h = b.height + eh;
    if (w <= 0 || h <= 0) continue;
    const x = b.x + b.width / 2 - w / 2; // keep the shape centred on the bounds
    const y = b.y + b.height / 2 - h / 2;

    let next: Item;
    if (shape === "ellipse") {
      next = makeEllipse(0, 0, w, h);
    } else if (shape === "rounded-rectangle") {
      const r = Math.min(opts.cornerRadius ?? 12, w / 2, h / 2);
      next = makeRect(0, 0, w, h, r, r);
    } else {
      next = makeRect(0, 0, w, h, 0, 0);
    }
    carryItemState(next, item);
    // Position the shape where the object's bounds were (object transform + offset).
    next.transform = mul(item.transform, translation(x, y));

    loc.container.splice(loc.index, 1, next);
    done.push(next.id);
  }
  return done;
};
