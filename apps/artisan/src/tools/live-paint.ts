// ─────────────────────────────────────────────────────────────
// tools/live-paint — Live Paint Bucket + Live Paint Selection
// ─────────────────────────────────────────────────────────────
// Pragmatic Live Paint: the bucket fills the shape under the cursor with the
// current fill; the selection tool picks the shape (face) under the cursor.

import { Ops, Query } from "../engine";
import type { Tool } from "./types";

export function createLivePaintBucketTool(): Tool {
  return {
    id: "live-paint-bucket",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 4 / ctx.zoom);
      if (!hit) return;
      const id = hit.leaf.item.id;
      const state = store.getState();
      store.transact("Live Paint", (d) => {
        if (state.activePaint === "stroke") {
          if (!Ops.LivePaint.applyEdgeStroke(d, id, state.stroke)) Ops.Paint.applyStroke(d, [id], state.stroke);
        } else if (!Ops.LivePaint.applyFaceFill(d, id, state.fill)) {
          Ops.Paint.applyFill(d, [id], state.fill);
        }
      });
    },
  };
}

export function createLivePaintSelectionTool(): Tool {
  return {
    id: "live-paint-selection",
    cursor: "default",
    onPointerDown(p, ctx) {
      const hit = Query.hitTest(ctx.store.doc, p.world, 4 / ctx.zoom);
      if (hit) ctx.store.setSelection([hit.leaf.item.id]);
      else ctx.store.clearSelection();
    },
  };
}
