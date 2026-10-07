// ─────────────────────────────────────────────────────────────
// flip.ts — pure mirror maths for "Flip Horizontal / Flip Vertical".
//
// Unity flips a 2D sprite with SpriteRenderer.flipX / flipY; its docs note that
// to flip the transform (and everything attached) you negate the transform
// scale instead. Jouer's flip does exactly that — negate the object's scale on
// the axis — and, for a multi-object selection, also mirrors each object's
// position across the selection's shared centre so the group flips as a whole.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

export type FlipAxis = "horizontal" | "vertical";

export interface FlipItem {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/** Mirror each item across the bounding-box centre of all items on `axis`:
 *  horizontal negates scaleX and reflects x; vertical negates scaleY and
 *  reflects y. A single item flips in place (its centre is itself, so only the
 *  scale changes). Empty input yields an empty result. Other fields pass
 *  through untouched. */
export function flipTransforms<T extends FlipItem>(items: T[], axis: FlipAxis): T[] {
  if (items.length === 0) return [];
  const xs = items.map((i) => i.x);
  const ys = items.map((i) => i.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return items.map((i) =>
    axis === "horizontal"
      ? { ...i, x: 2 * cx - i.x, scaleX: -i.scaleX }
      : { ...i, y: 2 * cy - i.y, scaleY: -i.scaleY },
  );
}
