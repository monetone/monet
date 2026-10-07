// ─────────────────────────────────────────────────────────────
// tools/knife — cut shapes along a drawn straight line
// ─────────────────────────────────────────────────────────────
// Each crossed shape is divided into two separate pieces that share the cut edge
// (no gap), like Illustrator's Knife — see Ops.Pathfinder.knifeCut.

import { BBox, Ops, type Point, Query, Vec } from "../engine";
import type { Tool } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";

export function createKnifeTool(): Tool {
  let startWorld: Point | null = null;
  let startScreen: Point = { x: 0, y: 0 };
  let curScreen: Point = { x: 0, y: 0 };

  return {
    id: "knife",
    cursor: "crosshair",
    onPointerDown(p) {
      startWorld = p.world;
      startScreen = p.screen;
      curScreen = p.screen;
    },
    onPointerMove(p, ctx) {
      if (!startWorld) return;
      curScreen = p.screen;
      ctx.requestRender();
    },
    onPointerUp(p, ctx) {
      const store = ctx.store;
      const sw = startWorld;
      if (sw && Vec.dist(p.world, sw) > 1) {
        const bounds = BBox.fromPoints([sw, p.world]);
        const affected = Query.itemsInRect(store.doc, BBox.inflate(bounds, 1), "crossing");
        if (affected.length) {
          let cutIds: string[] = [];
          store.transact("Knife", (d) => {
            cutIds = Ops.Pathfinder.knifeCut(d, affected, sw, p.world);
          });
          if (cutIds.length) store.setSelection(cutIds);
        }
      }
      startWorld = null;
      ctx.requestRender();
    },
    renderOverlay() {
      if (!startWorld) return null;
      return <line x1={startScreen.x} y1={startScreen.y} x2={curScreen.x} y2={curScreen.y} stroke={ACCENT} strokeWidth={1} strokeDasharray="2 2" />;
    },
  };
}
