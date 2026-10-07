// ─────────────────────────────────────────────────────────────
// tools/path-tools — Add / Delete / Convert Anchor + Scissors
// ─────────────────────────────────────────────────────────────

import { Mat, type Document, Ops, type Point, Query, Vec } from "../engine";
import type { Tool } from "./types";
import { nearestAnchor } from "./anchor-query";

const ensurePath = (d: Document, id: string) => {
  const loc = Query.findItem(d, id);
  if (loc && loc.item.type !== "path" && loc.item.type !== "compound") Ops.PathEdit.convertToPath(d, id);
};

export function createAddAnchorTool(): Tool {
  return {
    id: "add-anchor",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 6 / ctx.zoom);
      if (!hit) return;
      const id = hit.leaf.item.id;
      store.transact("Add Anchor", (d) => {
        ensurePath(d, id);
        const loc = Query.findItem(d, id);
        if (loc && (loc.item.type === "path" || loc.item.type === "compound")) {
          const world = Query.worldTransformAt(loc);
          const local = Mat.applyToPoint(Mat.invert(world), p.world);
          const h = Ops.PathEdit.nearestEditableSegment(d, id, local);
          if (h) Ops.PathEdit.insertAnchorAt(d, id, h.pathIndex, h.segIndex, h.t);
        }
      });
      store.setSelection([id]);
    },
  };
}

export function createDeleteAnchorTool(): Tool {
  return {
    id: "delete-anchor",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const near = nearestAnchor(store.doc, p.screen, ctx.worldToScreen);
      if (!near) return;
      store.transact("Delete Anchor", (d) => {
        ensurePath(d, near.id);
        Ops.PathEdit.deleteAnchors(d, near.id, [near.index]);
      });
      store.setSelection([near.id]);
    },
  };
}

export function createConvertAnchorTool(): Tool {
  let id: string | null = null;
  let index = -1;
  let startDoc: Document | null = null;
  let started = false;
  let startScreen: Point = { x: 0, y: 0 };
  return {
    id: "convert-anchor",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const near = nearestAnchor(ctx.store.doc, p.screen, ctx.worldToScreen);
      id = near ? near.id : null;
      index = near ? near.index : -1;
      started = false;
      startScreen = p.screen;
    },
    onPointerMove(p, ctx) {
      if (id == null) return;
      if (!started && Vec.dist(p.screen, startScreen) <= 3) return;
      const store = ctx.store;
      if (!started) {
        const loc0 = Query.findItem(store.doc, id);
        if (loc0 && loc0.item.type !== "path" && loc0.item.type !== "compound") store.transact("Convert to Path", (d) => Ops.PathEdit.convertToPath(d, id!));
        startDoc = store.doc;
        store.beginTransaction("Convert Anchor");
        started = true;
      }
      const loc = Query.findItem(startDoc!, id);
      if (!loc) return;
      const a = Ops.PathEdit.editableAnchorRefs(startDoc!, id)[index]?.anchor;
      if (!a) return;
      const world = Query.worldTransformAt(loc);
      const localCur = Mat.applyToPoint(Mat.invert(world), p.rawWorld);
      const vec = { x: localCur.x - a.point.x, y: localCur.y - a.point.y };
      store.mutateFrom(startDoc!, (d) => Ops.PathEdit.setHandle(d, id!, index, "out", vec, true));
    },
    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      else if (id != null) {
        // Click is one-way: a smooth point becomes a corner; clicking a corner
        // does nothing (dragging a corner makes it smooth — handled above).
        const a = Ops.PathEdit.editableAnchorRefs(ctx.store.doc, id)[index]?.anchor;
        const smooth = !!a && !!(a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y);
        if (smooth) ctx.store.transact("Convert Anchor", (d) => Ops.PathEdit.cornerAnchor(d, id!, index));
      }
      started = false;
      id = null;
      startDoc = null;
    },
  };
}

export function createScissorsTool(): Tool {
  return {
    id: "scissors",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 6 / ctx.zoom);
      if (!hit) return;
      const id = hit.leaf.item.id;
      store.transact("Cut Path", (d) => {
        ensurePath(d, id);
        const loc = Query.findItem(d, id);
        if (loc && (loc.item.type === "path" || loc.item.type === "compound")) {
          const world = Query.worldTransformAt(loc);
          const local = Mat.applyToPoint(Mat.invert(world), p.world);
          const h = Ops.PathEdit.nearestEditableSegment(d, id, local);
          if (h) Ops.PathEdit.cutPathAt(d, id, h.segIndex, h.t, h.pathIndex);
        }
      });
    },
  };
}

export function createSmoothTool(): Tool {
  let ids: string[] = [];
  let started = false;
  return {
    id: "smooth",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      ids = store.selection.length ? store.selection.slice() : [];
      if (!ids.length) {
        const hit = Query.hitTest(store.doc, p.world, 4 / ctx.zoom);
        if (hit) {
          ids = [hit.target.item.id];
          store.setSelection(ids);
        }
      }
      started = false;
    },
    onPointerMove(p, ctx) {
      if (!ids.length) return;
      const store = ctx.store;
      if (!started) {
        store.beginTransaction("Smooth");
        store.mutate((d) => {
          for (const id of ids) {
            const loc = Query.findItem(d, id);
            if (loc && loc.item.type !== "path" && loc.item.type !== "compound") Ops.PathEdit.convertToPath(d, id);
          }
        });
        started = true;
      }
      const radiusWorld = 40 / ctx.zoom;
      store.mutate((d) => {
        for (const id of ids) {
          const loc = Query.findItem(d, id);
          if (!loc || (loc.item.type !== "path" && loc.item.type !== "compound")) continue;
          const world = Query.worldTransformAt(loc);
          const center = Mat.applyToPoint(Mat.invert(world), p.world);
          const scale = Mat.meanScale(world) || 1;
          Ops.PathEdit.smoothNear(d, id, center, radiusWorld / scale, 0.5);
        }
      });
    },
    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      started = false;
      ids = [];
    },
  };
}
