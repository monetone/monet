// ─────────────────────────────────────────────────────────────
// tools/slice — Slice (create export regions) + Slice Selection (move)
// ─────────────────────────────────────────────────────────────

import { type Document, type Point, newId } from "../engine";
import type { Tool } from "./types";

export function createSliceTool(): Tool {
  let id: string | null = null;
  let start: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;

  return {
    id: "slice",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      start = p.world;
      store.beginTransaction("Slice");
      const slice = { id: newId("S"), name: "Slice", x: start.x, y: start.y, width: 1, height: 1 };
      store.mutate((d) => {
        if (!d.slices) d.slices = [];
        d.slices.push(slice);
      });
      id = slice.id;
      startDoc = store.doc;
      store.setSelectedSlice(id);
    },
    onPointerMove(p, ctx) {
      if (!id) return;
      ctx.store.mutateFrom(startDoc!, (d) => {
        const s = d.slices?.find((x) => x.id === id);
        if (s) {
          s.x = Math.min(start.x, p.world.x);
          s.y = Math.min(start.y, p.world.y);
          s.width = Math.abs(p.world.x - start.x) || 1;
          s.height = Math.abs(p.world.y - start.y) || 1;
        }
      });
    },
    onPointerUp(_p, ctx) {
      if (id) ctx.store.endTransaction();
      id = null;
      startDoc = null;
    },
  };
}

export function createSliceSelectionTool(): Tool {
  let id: string | null = null;
  let start: Point = { x: 0, y: 0 };
  let slStart: Point | null = null;
  let startDoc: Document | null = null;
  let started = false;

  return {
    id: "slice-selection",
    cursor: "default",
    onPointerDown(p, ctx) {
      const slices = ctx.store.doc.slices ?? [];
      const hit = [...slices].reverse().find((s) => p.world.x >= s.x && p.world.x <= s.x + s.width && p.world.y >= s.y && p.world.y <= s.y + s.height);
      if (hit) {
        id = hit.id;
        ctx.store.setSelectedSlice(id);
        start = p.world;
        slStart = { x: hit.x, y: hit.y };
        started = false;
      } else {
        id = null;
        ctx.store.setSelectedSlice(undefined);
      }
    },
    onPointerMove(p, ctx) {
      if (!id || !slStart) return;
      if (!started) {
        ctx.store.beginTransaction("Move Slice");
        startDoc = ctx.store.doc;
        started = true;
      }
      const dx = p.world.x - start.x;
      const dy = p.world.y - start.y;
      ctx.store.mutateFrom(startDoc!, (d) => {
        const s = d.slices?.find((x) => x.id === id);
        if (s && slStart) {
          s.x = slStart.x + dx;
          s.y = slStart.y + dy;
        }
      });
    },
    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      started = false;
      startDoc = null;
      // Same guard as the drag path reads (`if (!id || !slStart) return`) —
      // leaving them set made the next hover drag the slice after the cursor.
      id = null;
      slStart = null;
    },
    onDeactivate(ctx) {
      if (started) ctx.store.cancelTransaction();
      started = false;
      startDoc = null;
      id = null;
      slStart = null;
    },
  };
}
