// ─────────────────────────────────────────────────────────────
// tools/snap — pointer snapping (grid + Smart-Guides anchor points)
// ─────────────────────────────────────────────────────────────

import { type EditorState, type Point, Mat, Path, Query, Shapes, Vec } from "../engine";

/** Nearest anchor point (in world space) of any visible, NON-selected object
 *  within `tolWorld` of `world` — the basis of Illustrator's Smart-Guides "snap
 *  to point". The selection is excluded so a dragged object doesn't snap to its
 *  own anchors. Returns null when nothing is in range. */
const nearestAnchor = (state: EditorState, world: Point, tolWorld: number): Point | null => {
  const exclude = new Set(state.selection);
  let best: Point | null = null;
  let bestD = tolWorld;
  Query.eachItem(state.doc, (item, loc) => {
    if (exclude.has(item.id) || loc.ancestors.some((a) => exclude.has(a.id))) return;
    if (!Query.isSelectableLocation(loc)) return;
    const geos = Shapes.localPaths(item);
    if (geos.length === 0) return;
    const m = Query.worldTransformAt(loc);
    for (const g of geos) {
      for (const a of g.anchors) {
        const w = Mat.applyToPoint(m, a.point);
        const d = Vec.dist(w, world);
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      }
    }
  });
  return best;
};

/** Nearest point ON a path segment (in world space) of any visible, NON-selected
 *  object within `tolWorld` — Illustrator's Smart-Guides "snap to object" (path
 *  edges). Distance is measured in WORLD space so scaled transforms are honoured. */
const nearestEdge = (state: EditorState, world: Point, tolWorld: number): Point | null => {
  const exclude = new Set(state.selection);
  let best: Point | null = null;
  let bestD = tolWorld;
  Query.eachItem(state.doc, (item, loc) => {
    if (exclude.has(item.id) || loc.ancestors.some((a) => exclude.has(a.id))) return;
    if (!Query.isSelectableLocation(loc)) return;
    const geos = Shapes.localPaths(item);
    if (geos.length === 0) return;
    const m = Query.worldTransformAt(loc);
    const local = Mat.applyToPoint(Mat.invert(m), world);
    for (const g of geos) {
      const hit = Path.nearest(g, local);
      if (!hit) continue;
      const w = Mat.applyToPoint(m, hit.point);
      const d = Vec.dist(w, world);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
  });
  return best;
};

export const snapPoint = (state: EditorState, world: Point): Point => {
  const { snap, grid } = state;
  if (!snap.enabled) return world;
  if (snap.toGrid && grid.size > 0) {
    return {
      x: Math.round(world.x / grid.size) * grid.size,
      y: Math.round(world.y / grid.size) * grid.size,
    };
  }
  // Snap to Pixel wins over Smart Guides, as in Illustrator: pixel-perfect screen
  // output beats landing exactly on a neighbour's anchor.
  if (snap.toPixel) return { x: Math.round(world.x), y: Math.round(world.y) };
  // Smart Guides: snap the pointer to a nearby anchor (preferred) or path edge.
  const z = Math.max(1e-6, state.view.zoom);
  const tol = snap.tolerance / z; // screen px → world units
  if (snap.toPoint) {
    const a = nearestAnchor(state, world, tol);
    if (a) return a; // anchors take priority over edges, à la Illustrator
  }
  if (snap.toObject) {
    const e = nearestEdge(state, world, tol);
    if (e) return e;
  }
  return world;
};

/** Constrain a move delta to the nearest 45° direction (Shift behaviour). Adobe
 *  Illustrator constrains dragging to multiples of 45° — horizontal, vertical, AND
 *  the two diagonals — projecting the drag onto the chosen axis (not just dropping
 *  the smaller component). */
export const constrainAxis = (dx: number, dy: number): { dx: number; dy: number } => {
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
  const a = constrainAngle(Math.atan2(dy, dx));
  let ux = Math.cos(a);
  let uy = Math.sin(a);
  if (Math.abs(ux) < 1e-9) ux = 0; // keep the cardinal axes exact
  if (Math.abs(uy) < 1e-9) uy = 0;
  const proj = dx * ux + dy * uy; // project the drag onto the constraint axis
  return { dx: proj * ux, dy: proj * uy };
};

/** Round a value to a 45° increment angle (radians). */
export const constrainAngle = (rad: number): number => {
  const step = Math.PI / 4;
  return Math.round(rad / step) * step;
};
