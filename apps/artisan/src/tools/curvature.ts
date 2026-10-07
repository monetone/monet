// ─────────────────────────────────────────────────────────────
// tools/curvature — Illustrator's Curvature tool (⇧~)
// ─────────────────────────────────────────────────────────────
// Click to drop points; the path is continuously re-fitted as a smooth curve
// running THROUGH every point (Catmull-Rom tangents), so you shape a curve by
// placing it rather than by dragging handles. Alt/Option-click drops a corner
// point instead of a smooth one, double-click on an existing point toggles it
// between smooth and corner, clicking the first point closes the path, and
// Enter / Escape finishes the open path.

import { type Document, Ops, Path, type Point, Query, Vec, makePath, noPaint } from "../engine";
import type { Tool, ToolContext } from "./types";

export const createCurvatureTool = (): Tool => {
  let id: string | null = null;
  let startDoc: Document | null = null;
  let pts: Point[] = [];
  let corners = new Set<number>();
  /** Live rubber-band point (hover), not yet committed. */
  let preview: Point | null = null;

  const geometry = (closed: boolean, extra: Point | null) => {
    const all = extra ? [...pts, extra] : pts;
    return { anchors: Path.smoothThrough(all, closed, corners), closed };
  };

  /** Push the current point list into the live path item. */
  const sync = (ctx: ToolContext, closed = false) => {
    if (!id || !startDoc) return;
    const geo = geometry(closed, preview);
    ctx.store.mutateFrom(startDoc, (d) => {
      const loc = Query.findItem(d, id!);
      if (loc && loc.item.type === "path") loc.item.geometry = geo;
    });
  };

  const finish = (ctx: ToolContext, closed: boolean) => {
    if (!id) return;
    preview = null;
    // Fewer than two real points is a stray click — roll the whole draw back.
    if (pts.length < 2) {
      ctx.store.cancelTransaction();
    } else {
      sync(ctx, closed);
      ctx.store.endTransaction();
    }
    id = null;
    startDoc = null;
    pts = [];
    corners = new Set();
    ctx.requestRender();
  };

  return {
    id: "curvature",
    cursor: "crosshair",
    receivesHover: true,

    onDeactivate(ctx) {
      finish(ctx, false);
    },

    onKeyDown(e, ctx) {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        finish(ctx, false);
      }
    },

    onPointerDown(p, ctx) {
      const st = ctx.store.getState();
      const tol = 6 / ctx.zoom;

      if (!id) {
        pts = [p.world];
        corners = p.alt ? new Set([0]) : new Set();
        preview = null;
        const item = makePath(geometry(false, null), { fill: noPaint(), stroke: st.stroke, name: "Path" });
        ctx.store.beginTransaction("Curvature");
        ctx.store.mutate((d) => {
          Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
        });
        id = item.id;
        startDoc = ctx.store.doc;
        ctx.store.setSelection([item.id]);
        ctx.requestRender();
        return;
      }

      // Clicking the first point again closes the path.
      if (pts.length >= 2 && Vec.dist(p.world, pts[0]) <= tol) {
        finish(ctx, true);
        return;
      }
      // Clicking an existing point toggles smooth ↔ corner rather than stacking
      // a duplicate anchor on top of it.
      const existing = pts.findIndex((q) => Vec.dist(p.world, q) <= tol);
      if (existing >= 0) {
        corners.has(existing) ? corners.delete(existing) : corners.add(existing);
        preview = null;
        sync(ctx);
        ctx.requestRender();
        return;
      }

      pts.push(p.world);
      if (p.alt) corners.add(pts.length - 1);
      preview = null;
      sync(ctx);
      ctx.requestRender();
    },

    onPointerMove(p, ctx) {
      if (!id) return;
      preview = p.world;
      sync(ctx);
    },

    onDoubleClick(_p, ctx) {
      finish(ctx, false);
    },
  };
};
