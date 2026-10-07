// ─────────────────────────────────────────────────────────────
// tools/anchor-query — shared nearest-anchor hit-test for path tools
// ─────────────────────────────────────────────────────────────
// Used by Delete/Convert Anchor and Width; Add/Scissors route by segment instead.

import { Mat, type Document, Ops, type Point, Query, Shapes, Vec } from "../engine";

/** Live-shape types whose derived path vertices are hit-testable as anchors. */
export const LIVE_SHAPES = new Set(["rect", "ellipse", "polygon", "star", "line"]);

export interface NearAnchor {
  id: string;
  index: number;
  dist: number;
}

/** The nearest path/compound/live-shape anchor to a screen point, within `tol` px (or null). */
export function nearestAnchor(
  doc: Document,
  screen: Point,
  worldToScreen: (p: Point) => Point,
  tol = 7,
  opts: { includeLocked?: boolean; includeCompounds?: boolean } = {},
): NearAnchor | null {
  let best: NearAnchor | null = null;
  Query.eachItem(doc, (item, loc) => {
    if (!opts.includeLocked && !Query.isSelectableLocation(loc)) return;
    if (opts.includeLocked && (!item.visible || !loc.layer.visible || loc.ancestors.some((group) => !group.visible))) return;
    if (item.type === "compound" && opts.includeCompounds === false) return;
    const world = Query.worldTransformAt(loc);
    const anchors = item.type === "path" || item.type === "compound"
      ? Ops.PathEdit.editableAnchorRefs(doc, item.id).map((ref) => ref.anchor)
      : LIVE_SHAPES.has(item.type)
        ? Shapes.localPaths(item)[0]?.anchors
        : undefined;
    anchors?.forEach((a, i) => {
      const sp = worldToScreen(Mat.applyToPoint(world, a.point));
      const d = Vec.dist(sp, screen);
      if (d <= tol && (!best || d < best.dist)) best = { id: item.id, index: i, dist: d };
    });
  });
  return best;
}
