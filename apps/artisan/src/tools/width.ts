// ─────────────────────────────────────────────────────────────
// tools/width — variable-width stroke (drag a point to set local width)
// ─────────────────────────────────────────────────────────────

import { Mat, type Document, Ops, type Point, Query, Vec, paintedStroke, setPrimaryStroke } from "../engine";
import type { Tool } from "./types";
import { nearestAnchor } from "./anchor-query";

export function createWidthTool(): Tool {
  let id: string | null = null;
  let index = -1;
  let startDoc: Document | null = null;
  let started = false;
  let center: Point = { x: 0, y: 0 };

  return {
    id: "width",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const near = nearestAnchor(ctx.store.doc, p.screen, ctx.worldToScreen, 9);
      id = near ? near.id : null;
      index = near ? near.index : -1;
      started = false;
      center = p.world;
    },
    onPointerMove(p, ctx) {
      if (id == null) return;
      const store = ctx.store;
      if (!started) {
        const loc0 = Query.findItem(store.doc, id);
        if (loc0 && loc0.item.type !== "path" && loc0.item.type !== "compound")
          store.transact("Convert to Path", (d) => Ops.PathEdit.convertToPath(d, id!));
        startDoc = store.doc;
        store.beginTransaction("Width");
        started = true;
        const loc = Query.findItem(startDoc, id);
        const anchor = Ops.PathEdit.editableAnchorRefs(startDoc, id)[index]?.anchor;
        if (loc && anchor) center = Mat.applyToPoint(Query.worldTransformAt(loc), anchor.point);
      }
      // Width = twice the cursor's distance from the anchor (edge follows cursor).
      const distWorld = Vec.dist(p.world, center);
      store.mutateFrom(startDoc!, (d) => {
        const loc = Query.findItem(d, id!);
        if (!loc || (loc.item.type !== "path" && loc.item.type !== "compound")) return;
        const stroke = paintedStroke(loc.item);
        const base = Math.max(0.5, stroke.width);
        const anchorCount = Ops.PathEdit.editableAnchorRefs(d, id!).length;
        const profile = stroke.widthProfile
          ? stroke.widthProfile.slice()
          : new Array(anchorCount).fill(1);
        while (profile.length < anchorCount) profile.push(1);
        profile[index] = Math.max(0.1, (distWorld * 2) / base);
        setPrimaryStroke(loc.item, { ...stroke, widthProfile: profile });
      });
    },
    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      started = false;
      id = null;
      startDoc = null;
    },
  };
}
