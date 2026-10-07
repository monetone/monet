// ─────────────────────────────────────────────────────────────
// tools/eraser — drag to erase parts of shapes (boolean subtract a swept region)
// ─────────────────────────────────────────────────────────────

import { BBox, type Point, Query, Vec, Ops } from "../engine";
import type { Pair } from "polygon-clipping";
import type { Tool } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";

export function createEraserTool(): Tool {
  let worldPts: Point[] = [];
  let screenPts: Point[] = [];
  let radiusScreen = 12;

  return {
    id: "eraser",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      worldPts = [p.rawWorld];
      screenPts = [p.screen];
      radiusScreen = 12;
      ctx.requestRender();
    },
    onPointerMove(p, ctx) {
      if (worldPts.length === 0) return;
      const r = radiusScreen / 2;
      if (Vec.dist(screenPts[screenPts.length - 1], p.screen) >= r) {
        worldPts.push(p.rawWorld);
        screenPts.push(p.screen);
      }
      ctx.requestRender();
    },
    onPointerUp(_p, ctx) {
      const store = ctx.store;
      if (worldPts.length) {
        // half-width in world units; radiusScreen is the brush *diameter* (the
        // overlay stroke width), so halve it to match the visible brush.
        const r = radiusScreen / 2 / ctx.zoom;
        const region = worldPts.map((pt) => [
          [
            [pt.x - r, pt.y - r],
            [pt.x + r, pt.y - r],
            [pt.x + r, pt.y + r],
            [pt.x - r, pt.y + r],
          ] as Pair[],
        ]);
        const bounds = BBox.fromPoints(worldPts.flatMap((pt) => [
          { x: pt.x - r, y: pt.y - r },
          { x: pt.x + r, y: pt.y + r },
        ]));
        const affected = Query.itemsInRect(store.doc, bounds, "crossing");
        if (affected.length) {
          store.transact("Erase", (d) => Ops.Pathfinder.subtractRegionFromItems(d, affected, region));
        }
      }
      worldPts = [];
      screenPts = [];
      ctx.requestRender();
    },
    renderOverlay() {
      if (screenPts.length === 0) return null;
      const r = radiusScreen;
      return (
        <g pointerEvents="none">
          <polyline points={screenPts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={r} strokeLinecap="round" strokeLinejoin="round" opacity={0.18} />
        </g>
      );
    },
  };
}
