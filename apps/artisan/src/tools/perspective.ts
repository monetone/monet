// ─────────────────────────────────────────────────────────────
// tools/perspective — Perspective Grid (guide) + Perspective Selection (distort)
// ─────────────────────────────────────────────────────────────
// The engine is affine, so true projective transforms aren't representable;
// instead Perspective Selection stores a live-object metadata wrapper and
// regenerates a bilinear fallback. Perspective Grid toggles a 1-point guide.

import { Mat, Ops, perspectiveCornersForHorizontalAmount, type Document, type Point } from "../engine";
import type { Tool } from "./types";

export function createPerspectiveSelectionTool(): Tool {
  let ids: string[] = [];
  let groupId: string | null = null;
  let startDoc: Document | null = null;
  let started = false;
  let startWorld: Point = { x: 0, y: 0 };

  // onPointerMove fires on every HOVER too, so the drag path must be gated on a
  // button actually being down — otherwise a later hover with a stale `ids`
  // wraps the artwork in another Perspective Group and leaves a transaction open.
  let dragging = false;

  const reset = (ctx: { store: { cancelTransaction: () => void } }) => {
    if (started) ctx.store.cancelTransaction();
    dragging = false;
    started = false;
    startDoc = null;
    ids = [];
    groupId = null;
  };

  return {
    id: "perspective-selection",
    cursor: "crosshair",
    onDeactivate(ctx) {
      reset(ctx);
    },
    onPointerDown(p, ctx) {
      ids = ctx.store.selection.slice();
      groupId = null;
      startWorld = p.world;
      started = false;
      dragging = true;
    },
    onPointerMove(p, ctx) {
      if (!dragging || !ids.length) return;
      const store = ctx.store;
      const amount = Math.max(-0.9, Math.min(0.9, (p.world.x - startWorld.x) / 300));
      const corners = perspectiveCornersForHorizontalAmount(amount);
      if (!started) {
        store.beginTransaction("Perspective");
        store.mutate((d) => {
          groupId = Ops.Perspective.makePerspectiveGroup(d, ids, { corners });
        });
        startDoc = store.doc;
        started = true;
        return;
      }
      store.mutateFrom(startDoc!, (d) => {
        if (groupId) Ops.Perspective.updatePerspectiveCorners(d, groupId, corners);
      });
    },
    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      dragging = false;
      started = false;
      startDoc = null;
      ids = [];
      groupId = null;
    },
  };
}

export function createPerspectiveGridTool(): Tool {
  return {
    id: "perspective-grid",
    cursor: "crosshair",
    onPointerDown(_p, ctx) {
      ctx.store.setPerspectiveGrid(!ctx.store.getState().perspectiveGrid);
    },
  };
}

export { Mat };
