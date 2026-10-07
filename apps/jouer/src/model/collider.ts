// ─────────────────────────────────────────────────────────────
// collider.ts — pure geometry for a circular physics collider.
//
// Unity's 2D physics offers a BoxCollider2D (rectangle) and a CircleCollider2D
// (circle). Jouer's arcade body is rectangular by default; choosing the "circle"
// shape exports a Phaser `body.setCircle(radius, offsetX, offsetY)` call. This
// module works out that circle so it fits the object's box and stays centred,
// shared by the exporter and the live engine player.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

/** The args Phaser's `body.setCircle` needs, centred in the object's box.
 *  `radiusOverride > 0` (Unity CircleCollider2D.radius) uses that radius; otherwise
 *  the auto-fit — the largest circle that fits the box. `width`/`height` default
 *  to 64 when unset (e.g. an untextured sprite). */
export function colliderCircle(o: { width?: number; height?: number }, radiusOverride?: number): { radius: number; offsetX: number; offsetY: number } {
  const w = o.width ?? 64;
  const h = o.height ?? 64;
  const radius = radiusOverride != null && radiusOverride > 0 ? radiusOverride : Math.min(w, h) / 2;
  return { radius, offsetX: w / 2 - radius, offsetY: h / 2 - radius };
}
