// ─────────────────────────────────────────────────────────────
// ops/transform-each — Object ▸ Transform ▸ Transform Each (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Unlike a normal transform — which scales/rotates the whole selection around
// ONE shared point — Transform Each applies the same scale, rotation and move to
// EACH selected object individually, around that object's OWN centre. Scaling a
// row of objects "Each" shrinks every object in place instead of collapsing them
// toward the group centre. Reflect X/Y are sign flips on the scale.

import { aroundPoint, mul, rotation, scaling, translation } from "../geometry/matrix";
import { worldBounds } from "../model/query";
import { transformItems } from "./transform";
import type { Document, ID } from "../model/types";

export interface TransformEachOptions {
  /** Horizontal scale factor (1 = 100%). */
  scaleX?: number;
  /** Vertical scale factor (1 = 100%). */
  scaleY?: number;
  /** Rotation in radians, around each object's own centre. */
  rotate?: number;
  /** Horizontal move (user units). */
  moveX?: number;
  /** Vertical move (user units). */
  moveY?: number;
  /** Mirror each object horizontally (scaleX × −1). */
  reflectX?: boolean;
  /** Mirror each object vertically (scaleY × −1). */
  reflectY?: boolean;
}

export const transformEach = (doc: Document, ids: Iterable<ID>, opts: TransformEachOptions = {}): void => {
  const sx = (opts.scaleX ?? 1) * (opts.reflectX ? -1 : 1);
  const sy = (opts.scaleY ?? 1) * (opts.reflectY ? -1 : 1);
  const rot = opts.rotate ?? 0;
  const mx = opts.moveX ?? 0;
  const my = opts.moveY ?? 0;

  for (const id of ids) {
    const b = worldBounds(doc, id);
    if (!b) continue;
    const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    // Scale then rotate around the object's own centre, then move (all world space).
    const world = mul(translation(mx, my), aroundPoint(center, mul(rotation(rot), scaling(sx, sy))));
    transformItems(doc, [id], world);
  }
};
