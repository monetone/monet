// ─────────────────────────────────────────────────────────────
// tools/artboard-tool — create / select / move artboards
// ─────────────────────────────────────────────────────────────

import { type Document, type Point, newId } from "../engine";
import type { Tool } from "./types";

export function createArtboardTool(): Tool {
  let mode: "idle" | "create" | "move" = "idle";
  let start: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;
  let abIndex = -1;
  let abStart: { x: number; y: number } | null = null;
  let started = false;

  return {
    id: "artboard",
    cursor: "crosshair",

    onPointerDown(p, ctx) {
      const store = ctx.store;
      const d = store.doc;
      start = p.world;
      started = false;
      const idx = d.artboards.findIndex(
        (ab) => p.world.x >= ab.x && p.world.x <= ab.x + ab.width && p.world.y >= ab.y && p.world.y <= ab.y + ab.height,
      );
      if (idx >= 0) {
        mode = "move";
        abIndex = idx;
        abStart = { x: d.artboards[idx].x, y: d.artboards[idx].y };
        store.mutate((dd) => {
          dd.activeArtboard = idx;
        });
      } else {
        mode = "create";
        abIndex = -1;
      }
    },

    onPointerMove(p, ctx) {
      const store = ctx.store;
      if (mode === "create") {
        if (!started) {
          store.beginTransaction("New Artboard");
          store.mutate((d) => {
            d.artboards.push({
              id: newId("A"),
              name: `Artboard ${d.artboards.length + 1}`,
              x: Math.min(start.x, p.world.x),
              y: Math.min(start.y, p.world.y),
              width: Math.abs(p.world.x - start.x) || 1,
              height: Math.abs(p.world.y - start.y) || 1,
            });
            d.activeArtboard = d.artboards.length - 1;
          });
          abIndex = store.doc.artboards.length - 1;
          startDoc = store.doc;
          started = true;
        } else {
          store.mutateFrom(startDoc!, (d) => {
            const ab = d.artboards[abIndex];
            if (ab) {
              ab.x = Math.min(start.x, p.world.x);
              ab.y = Math.min(start.y, p.world.y);
              ab.width = Math.abs(p.world.x - start.x) || 1;
              ab.height = Math.abs(p.world.y - start.y) || 1;
            }
          });
        }
      } else if (mode === "move" && abStart) {
        if (!started) {
          store.beginTransaction("Move Artboard");
          startDoc = store.doc;
          started = true;
        }
        const dx = p.world.x - start.x;
        const dy = p.world.y - start.y;
        store.mutateFrom(startDoc!, (d) => {
          const ab = d.artboards[abIndex];
          if (ab && abStart) {
            ab.x = abStart.x + dx;
            ab.y = abStart.y + dy;
          }
        });
      }
    },

    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      mode = "idle";
      started = false;
      startDoc = null;
    },
  };
}
