// ─────────────────────────────────────────────────────────────
// tools/reshape — drag a path region; nearby anchors follow with falloff
// ─────────────────────────────────────────────────────────────

import { Mat, type Document, Ops, type Point, Query } from "../engine";
import type { Tool } from "./types";

const RADIUS_PX = 70;

export function createReshapeTool(): Tool {
  let id: string | null = null;
  let startWorld: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;
  let started = false;

  return {
    id: "reshape",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const hit = Query.hitTest(ctx.store.doc, p.world, 6 / ctx.zoom);
      id = hit ? hit.leaf.item.id : null;
      startWorld = p.world;
      started = false;
    },
    onPointerMove(p, ctx) {
      if (!id) return;
      const store = ctx.store;
      if (!started) {
        const loc0 = Query.findItem(store.doc, id);
        if (loc0 && loc0.item.type !== "path" && loc0.item.type !== "compound") store.transact("Convert to Path", (d) => Ops.PathEdit.convertToPath(d, id!));
        startDoc = store.doc;
        store.beginTransaction("Reshape");
        started = true;
      }
      const radiusWorld = RADIUS_PX / ctx.zoom;
      const worldDelta = { x: p.world.x - startWorld.x, y: p.world.y - startWorld.y };
      store.mutateFrom(startDoc!, (d) => {
        const loc = Query.findItem(d, id!);
        if (!loc || (loc.item.type !== "path" && loc.item.type !== "compound")) return;
        const world = Query.worldTransformAt(loc);
        const inv = Mat.invert(world);
        const center = Mat.applyToPoint(inv, startWorld);
        const localDelta = Mat.applyToVector(inv, worldDelta);
        const scale = Mat.meanScale(world) || 1;
        Ops.Liquify.liquify(d, id!, center, radiusWorld / scale, Ops.Liquify.warpFn(localDelta, 1));
      });
    },
    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      id = null;
      started = false;
      startDoc = null;
    },
  };
}
