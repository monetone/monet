// ─────────────────────────────────────────────────────────────
// tools/select-extra — Lasso + Magic Wand selection tools
// ─────────────────────────────────────────────────────────────

import { type Point, Query } from "../engine";
import type { Tool, ToolContext } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";

export function createLassoTool(): Tool {
  let screenPts: Point[] = []; // for the overlay
  let worldPts: Point[] = []; // for hit-testing (touch-select)
  let active = false;
  return {
    id: "lasso",
    cursor: "crosshair",
    onPointerDown(p) {
      screenPts = [p.screen];
      worldPts = [p.rawWorld ?? p.world];
      active = true;
    },
    onPointerMove(p, ctx) {
      if (!active) return;
      screenPts.push(p.screen);
      worldPts.push(p.rawWorld ?? p.world);
      ctx.requestRender();
    },
    onPointerUp(_p, ctx) {
      if (!active) return;
      active = false;
      // Touch-select: any object whose bounds intersect the lasso (like the
      // rectangular marquee), not just objects whose centre is enclosed.
      ctx.store.setSelection(worldPts.length >= 3 ? Query.itemsInPolygon(ctx.store.doc, worldPts) : []);
      screenPts = [];
      worldPts = [];
      ctx.requestRender();
    },
    renderOverlay() {
      if (screenPts.length < 2) return null;
      return (
        <polygon
          points={screenPts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="rgba(74,158,255,0.08)"
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      );
    },
  };
}

export function createMagicWandTool(): Tool {
  return {
    id: "magic-wand",
    cursor: "crosshair",
    onPointerDown(p, ctx: ToolContext) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 4 / ctx.zoom);
      if (!hit) {
        store.clearSelection();
        return;
      }
      // Select all objects matching the clicked object's chosen attribute (Fill or
      // Stroke colour) within the Magic Wand tolerance — see the options bar.
      const mw = store.getState().magicWand;
      store.setSelection(Query.magicWandSelectBy(store.doc, hit.leaf.item, mw.match, mw.tolerance));
    },
  };
}
