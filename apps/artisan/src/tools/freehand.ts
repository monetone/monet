// ─────────────────────────────────────────────────────────────
// tools/freehand — Pencil (freehand → smoothed bezier path)
// ─────────────────────────────────────────────────────────────

import { type Document, Ops, Path, type Point, Query, Vec, makeAnchor, makePath, noPaint } from "../engine";
import type { Tool } from "./types";

const decimate = (pts: Point[], minDist: number): Point[] => {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (Vec.dist(out[out.length - 1], pts[i]) >= minDist) out.push(pts[i]);
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
};

/** Catmull-Rom → cubic handles for a smooth open curve through the points. */
const smooth = (pts: Point[]) => Path.smoothThrough(pts);

export function createPencilTool(): Tool {
  let id: string | null = null;
  let startDoc: Document | null = null;
  let raw: Point[] = [];

  return {
    id: "pencil",
    cursor: "crosshair",

    onPointerDown(p, ctx) {
      const store = ctx.store;
      const st = store.getState();
      raw = [p.rawWorld];
      const item = makePath({ closed: false, anchors: [makeAnchor(p.rawWorld)] }, { fill: noPaint(), stroke: st.stroke, name: "Path" });
      store.beginTransaction("Pencil");
      store.mutate((d) => {
        Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
      });
      id = item.id;
      startDoc = store.doc;
      store.setSelection([item.id]);
    },

    onPointerMove(p, ctx) {
      if (!id) return;
      const minDist = 2 / ctx.zoom;
      if (Vec.dist(raw[raw.length - 1], p.rawWorld) < minDist) return;
      raw.push(p.rawWorld);
      const anchors = raw.map((pt) => makeAnchor(pt));
      ctx.store.mutateFrom(startDoc!, (d) => {
        const loc = Query.findItem(d, id!);
        if (loc && loc.item.type === "path") loc.item.geometry = { closed: false, anchors };
      });
    },

    // A tool switch mid-stroke otherwise leaves `id` + `startDoc` set, so the
    // next hover passes the `if (!id) return` guard and mutateFrom(startDoc)
    // reverts the whole document to the abandoned stroke's snapshot — outside
    // any transaction, so it cannot even be undone.
    onDeactivate(ctx) {
      if (!id) return;
      ctx.store.cancelTransaction();
      id = null;
      startDoc = null;
      raw = [];
    },

    onPointerUp(_p, ctx) {
      if (!id) return;
      const pts = decimate(raw, 3 / ctx.zoom);
      if (pts.length < 2) {
        ctx.store.cancelTransaction();
      } else {
        ctx.store.mutateFrom(startDoc!, (d) => {
          const loc = Query.findItem(d, id!);
          if (loc && loc.item.type === "path") loc.item.geometry = { closed: false, anchors: smooth(pts) };
        });
        ctx.store.endTransaction();
      }
      id = null;
      startDoc = null;
      raw = [];
    },
  };
}
