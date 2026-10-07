// ─────────────────────────────────────────────────────────────
// tools/handles — selection bounding-box handle geometry
// ─────────────────────────────────────────────────────────────
// Handles are computed from the selection's world-space AABB. Because the
// viewport transform is scale+translate only (no rotation), the world AABB maps
// to a screen-aligned rectangle, so handle hit-testing is simple.

import type { Point, Rect } from "../engine";

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rot";

export interface HandleSet {
  /** World-space handle anchor points. */
  world: Record<Exclude<HandleId, "rot">, Point>;
  /** Screen-space handle points (incl. rotation handle). */
  screen: Record<HandleId, Point>;
  /** The selection AABB corners in screen space (for the outline). */
  rectScreen: { x: number; y: number; w: number; h: number };
  center: Point; // world
}

export const ROTATION_OFFSET = 22; // px above the top edge

export const handlesForBounds = (b: Rect, worldToScreen: (p: Point) => Point): HandleSet => {
  const world = {
    nw: { x: b.x, y: b.y },
    n: { x: b.x + b.width / 2, y: b.y },
    ne: { x: b.x + b.width, y: b.y },
    e: { x: b.x + b.width, y: b.y + b.height / 2 },
    se: { x: b.x + b.width, y: b.y + b.height },
    s: { x: b.x + b.width / 2, y: b.y + b.height },
    sw: { x: b.x, y: b.y + b.height },
    w: { x: b.x, y: b.y + b.height / 2 },
  };
  const screenEntries = Object.fromEntries(
    Object.entries(world).map(([k, p]) => [k, worldToScreen(p)]),
  ) as Record<Exclude<HandleId, "rot">, Point>;
  const nScreen = screenEntries.n;
  const rot = { x: nScreen.x, y: nScreen.y - ROTATION_OFFSET };
  const nw = screenEntries.nw;
  const se = screenEntries.se;
  return {
    world,
    screen: { ...screenEntries, rot },
    rectScreen: { x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y },
    center: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
  };
};

/** The opposite handle (drag pivot) for a scale handle. */
export const oppositeHandle: Record<Exclude<HandleId, "rot">, Exclude<HandleId, "rot">> = {
  nw: "se",
  n: "s",
  ne: "sw",
  e: "w",
  se: "nw",
  s: "n",
  sw: "ne",
  w: "e",
};

/** Hit-test screen handles; returns the nearest within `tol` px, or null. */
export const hitHandle = (handles: HandleSet, screen: Point, tol = 7): HandleId | null => {
  let best: HandleId | null = null;
  let bestD = tol * tol;
  for (const [k, p] of Object.entries(handles.screen) as [HandleId, Point][]) {
    const dx = p.x - screen.x;
    const dy = p.y - screen.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
};

export const handleCursor: Record<HandleId, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  rot: "grab",
};
