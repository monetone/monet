// ─────────────────────────────────────────────────────────────
// tools/view — Hand (pan) and Zoom tools
// ─────────────────────────────────────────────────────────────

import { type Point, Vec } from "../engine";
import type { Tool, ToolContext } from "./types";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Set zoom while keeping the world point under `anchor` (screen px) fixed. */
export const zoomAt = (ctx: ToolContext, nextZoom: number, anchor: Point) => {
  const z = clampZoom(nextZoom);
  const world = ctx.screenToWorld(anchor);
  const angle = ctx.state.view.angle || 0;
  const c = { x: ctx.viewport.width / 2, y: ctx.viewport.height / 2 };
  const s = angle ? Vec.rotateAround(anchor, c, -angle) : anchor;
  ctx.store.setView({ zoom: z, tx: s.x - world.x * z, ty: s.y - world.y * z });
};

/** Rotate the canvas view, keeping the viewport center fixed. */
export function createRotateViewTool(): Tool {
  let startAngle = 0;
  let startPointer = 0;
  let center: Point = { x: 0, y: 0 };
  let active = false;
  return {
    id: "rotate-view",
    cursor: "grab",
    onPointerDown(p, ctx) {
      center = { x: ctx.viewport.width / 2, y: ctx.viewport.height / 2 };
      startAngle = ctx.state.view.angle || 0;
      startPointer = Math.atan2(p.screen.y - center.y, p.screen.x - center.x);
      active = true;
    },
    onPointerMove(p, ctx) {
      if (!active) return;
      const cur = Math.atan2(p.screen.y - center.y, p.screen.x - center.x);
      const angle = startAngle + (cur - startPointer);
      // Keep the world point under the viewport center fixed.
      const world = ctx.screenToWorld(center);
      const v = ctx.state.view;
      ctx.store.setView({ angle, tx: center.x - world.x * v.zoom, ty: center.y - world.y * v.zoom });
    },
    onPointerUp() {
      active = false;
    },
  };
}

export function createHandTool(): Tool {
  let startScreen: Point = { x: 0, y: 0 };
  let startView = { tx: 0, ty: 0 };
  let panning = false;
  return {
    id: "hand",
    cursor: "grab",
    onPointerDown(p, ctx) {
      startScreen = p.screen;
      startView = { tx: ctx.state.view.tx, ty: ctx.state.view.ty };
      panning = true;
    },
    onPointerMove(p, ctx) {
      if (!panning) return;
      ctx.store.setView({ tx: startView.tx + (p.screen.x - startScreen.x), ty: startView.ty + (p.screen.y - startScreen.y) });
    },
    onPointerUp() {
      panning = false;
    },
  };
}

export function createZoomTool(): Tool {
  let startScreen: Point = { x: 0, y: 0 };
  let rect: { x: number; y: number; w: number; h: number } | null = null;
  let dragged = false;
  return {
    id: "zoom",
    cursor: "zoom-in",
    onPointerDown(p) {
      startScreen = p.screen;
      dragged = false;
      rect = null;
    },
    onPointerMove(p, ctx) {
      if (p.button < 0) return;
      if (Math.hypot(p.screen.x - startScreen.x, p.screen.y - startScreen.y) > 3) {
        dragged = true;
        rect = {
          x: Math.min(startScreen.x, p.screen.x),
          y: Math.min(startScreen.y, p.screen.y),
          w: Math.abs(p.screen.x - startScreen.x),
          h: Math.abs(p.screen.y - startScreen.y),
        };
        ctx.requestRender();
      }
    },
    onPointerUp(p, ctx) {
      if (dragged && rect && rect.w > 4 && rect.h > 4) {
        const { width, height } = ctx.viewport;
        const z = clampZoom(Math.min(width / rect.w, height / rect.h));
        const a = ctx.screenToWorld({ x: rect.x, y: rect.y });
        const b = ctx.screenToWorld({ x: rect.x + rect.w, y: rect.y + rect.h });
        const cw = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.store.setView({ zoom: z, tx: width / 2 - cw.x * z, ty: height / 2 - cw.y * z });
      } else {
        const factor = p.alt ? 0.5 : 2;
        zoomAt(ctx, ctx.state.view.zoom * factor, p.screen);
      }
      rect = null;
      dragged = false;
      ctx.requestRender();
    },
    renderOverlay() {
      if (!rect) return null;
      return (
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="rgba(74,158,255,0.08)" stroke="var(--accent-vector,#4a9eff)" strokeWidth={1} strokeDasharray="4 3" />
      );
    },
  };
}
