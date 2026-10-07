// ─────────────────────────────────────────────────────────────
// tools/shape-builder — region/face-based merge (Alt: delete)
// ─────────────────────────────────────────────────────────────
// Illustrator's Shape Builder: with overlapping shapes selected, drag across the
// faces you want to merge into one shape (Alt held = delete them). Untouched
// faces survive as their own shapes. See Ops.Pathfinder.shapeBuilder.

import { type Document, Ops, type Point, Query } from "../engine";
import type { Tool } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";

/** Fallback when nothing is selected: the shapes the drag passes over. */
const touchedShapes = (doc: Document, worldPts: Point[], zoom: number): string[] => {
  const set = new Set<string>();
  for (const p of worldPts) {
    const hit = Query.hitTest(doc, p, 3 / zoom);
    if (hit) set.add(hit.target.item.id);
  }
  return [...set];
};

export function createShapeBuilderTool(): Tool {
  let worldPts: Point[] = [];
  let screenPts: Point[] = [];
  let active = false;

  return {
    id: "shape-builder",
    cursor: "crosshair",
    onPointerDown(p) {
      worldPts = [p.world];
      screenPts = [p.screen];
      active = true;
    },
    onPointerMove(p, ctx) {
      if (!active) return;
      worldPts.push(p.world);
      screenPts.push(p.screen);
      ctx.requestRender();
    },
    onPointerUp(p, ctx) {
      if (!active) return;
      active = false;
      const store = ctx.store;
      // Operate on the selected overlapping shapes (Illustrator model); if nothing
      // is selected, fall back to the shapes the drag passed over.
      const ids = store.selection.length ? store.selection.slice() : touchedShapes(store.doc, worldPts, ctx.zoom);
      if (ids.length) {
        let nids: string[] = [];
        store.transact(p.alt ? "Shape Builder Delete" : "Shape Builder Merge", (d) => {
          nids = Ops.Pathfinder.shapeBuilder(d, ids, worldPts, p.alt ? "delete" : "merge");
        });
        store.setSelection(nids);
      }
      worldPts = [];
      screenPts = [];
      ctx.requestRender();
    },
    renderOverlay() {
      if (screenPts.length < 2) return null;
      return (
        <polyline points={screenPts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="2 3" opacity={0.8} />
      );
    },
  };
}
