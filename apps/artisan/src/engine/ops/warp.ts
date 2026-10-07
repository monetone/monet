// ─────────────────────────────────────────────────────────────
// ops/warp — Effect ▸ Warp ▸ Arc / Arc Lower / Arc Upper (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Warp (Effect ▸ Warp, or Object ▸ Envelope Distort ▸ Make
// with Warp) bends a shape inside its bounding box. The "Arc" family bows the
// shape vertically along a parabola: the left/right edges stay pinned and the
// horizontal centre moves the most. A Bend slider (−100%..100%) sets the amount.
//
//   Arc        bends the whole shape (vertical thickness preserved)
//   Arc Lower  pins the top edge, bends only the bottom
//   Arc Upper  pins the bottom edge, bends only the top
//
// We apply it destructively: each anchor AND its (absolute) bezier handle
// endpoints are displaced through the warp, so curved segments bend with the
// shape rather than just their anchors. Vertical lines stay vertical — the warp
// only moves points in y, by a function of their position in the shared bbox.

import type { Point } from "../geometry/vec";
import { type PathGeometry, bounds } from "../geometry/path";
import { type Rect, unionAll } from "../geometry/bbox";
import { convertToPath } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID, type WarpStyle } from "../model/types";

export type { WarpStyle };

export interface WarpOptions {
  /** Which edges bend. */
  style: WarpStyle;
  /** Bend amount, −1..1 (Illustrator's −100%..100%). 0 leaves the path unchanged. */
  bend: number;
  /** Bend everything inside ONE shared box (Envelope Distort) instead of each
   *  object inside its own bounds (Effect ▸ Warp, which is per-object). */
  box?: Rect;
}

// New absolute y for a point (x,y) within `box`, per warp style. Every style
// leaves x untouched (vertical lines stay vertical). Bend −1..1 sets the amount.
//   arc / arc-lower / arc-upper  shift y by bend·(h/2)·(1−u²)·weight: the 1−u²
//     parabola pins the left/right edges and moves the horizontal centre most,
//     and weight (1 / v / 1−v) selects which edges follow the bend.
//   flag   shift y by bend·(h/2)·sin(2π·s) — one sine ripple across the width,
//     uniform top-to-bottom (the shape flaps like a flag).
//   wave   shift y by bend·(h/2)·sin(4π·s) — two sine ripples across the width
//     (a tighter wave than Flag's single ripple), uniform top-to-bottom.
//   rise   shift y by bend·(h/2)·(−2s) = −bend·h·s — a linear vertical shear:
//     the left edge (s=0) is pinned and the right edge (s=1) rises by the full
//     bend·height, slanting the shape into a rising ramp (a parallelogram).
//   bulge  scale the height about the vertical centre by 1+bend·(1−u²) — the
//     horizontal centre swells outward while the left/right edges stay put.
// u = horizontal pos in [−1,1]; s = horizontal pos in [0,1]; v = vertical in [0,1].
const warpY = (x: number, y: number, box: Rect, style: WarpStyle, bend: number): number => {
  const { width: w, height: h } = box;
  if (w <= 0 || h <= 0) return y;
  const cy = box.y + h / 2;
  const u = (x - (box.x + w / 2)) / (w / 2);
  if (style === "bulge") return cy + (y - cy) * (1 + bend * (1 - u * u));
  const s = (x - box.x) / w; // horizontal position in [0,1]
  const v = (y - box.y) / h;
  const profile =
    style === "flag" ? Math.sin(2 * Math.PI * s) : style === "wave" ? Math.sin(4 * Math.PI * s) : style === "rise" ? -2 * s : 1 - u * u;
  const weight = style === "arc-lower" ? v : style === "arc-upper" ? 1 - v : 1;
  return y + bend * (h / 2) * profile * weight;
};

const warpGeometry = (g: PathGeometry, box: Rect, style: WarpStyle, bend: number): PathGeometry => ({
  closed: g.closed,
  anchors: g.anchors.map((a) => {
    const p = a.point;
    const np: Point = { x: p.x, y: warpY(p.x, p.y, box, style, bend) };
    // Warp the absolute handle endpoints too, then re-relativise to the moved anchor.
    const inAbsY = warpY(p.x + a.handleIn.x, p.y + a.handleIn.y, box, style, bend);
    const outAbsY = warpY(p.x + a.handleOut.x, p.y + a.handleOut.y, box, style, bend);
    return {
      ...a,
      point: np,
      handleIn: { x: a.handleIn.x, y: inAbsY - np.y },
      handleOut: { x: a.handleOut.x, y: outAbsY - np.y },
    };
  }),
});

/**
 * Effect ▸ Warp — bend each selected path / compound / live shape per the chosen
 * style (arc family, flag, wave, rise, or bulge). Mutates in place; returns
 * modified ids.
 */
export const warp = (doc: Document, ids: ID[], options: WarpOptions): ID[] => {
  const { style, bend, box: sharedBox } = options;
  if (!bend) return []; // a zero bend leaves every path unchanged

  const done: ID[] = [];
  for (const id of ids) {
    let loc = findItem(doc, id);
    if (!loc) continue;
    if (LIVE_SHAPES.includes(loc.item.type)) {
      convertToPath(doc, id);
      loc = findItem(doc, id);
      if (!loc) continue;
    }
    const it = loc.item;
    if (it.type === "path") {
      if (it.geometry.anchors.length < 2) continue;
      it.geometry = warpGeometry(it.geometry, sharedBox ?? bounds(it.geometry), style, bend);
      done.push(id);
    } else if (it.type === "compound") {
      const box = sharedBox ?? unionAll(it.subpaths.map((sp) => bounds(sp)));
      if (!box) continue;
      it.subpaths = it.subpaths.map((sp) => warpGeometry(sp, box, style, bend));
      done.push(id);
    }
  }
  return done;
};
