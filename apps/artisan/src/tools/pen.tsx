// ─────────────────────────────────────────────────────────────
// tools/pen — the Pen (P) tool: click to add corners, drag for smooth points
// ─────────────────────────────────────────────────────────────
// One open transaction spans the whole path: each click appends an anchor (in
// the path's local space); a click-drag sets that anchor's symmetric handles.
// Clicking the first anchor closes the path; Enter/Esc finishes/cancels.

import { Mat, Ops, type Point, Query, Vec, makeAnchor, makePath } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";
const CLOSE_TOL = 9;

export function createPenTool(): Tool {
  let itemId: string | null = null;
  let isDown = false;
  let dragIndex: number | null = null;
  let cursor: Point | null = null;

  const finish = (ctx: ToolContext, cancel = false) => {
    if (itemId) {
      const loc = Query.findItem(ctx.store.doc, itemId);
      const tooSmall = !loc || (loc.item.type === "path" && loc.item.geometry.anchors.length < 2);
      if (cancel || tooSmall) ctx.store.cancelTransaction();
      else ctx.store.endTransaction();
    }
    itemId = null;
    isDown = false;
    dragIndex = null;
    ctx.requestRender();
  };

  return {
    id: "pen",
    cursor: "crosshair",
    receivesHover: true,

    onPointerDown(p, ctx) {
      const store = ctx.store;
      if (itemId == null) {
        const st = store.getState();
        const item = makePath({ anchors: [makeAnchor(p.world)], closed: false }, { fill: st.fill, stroke: st.stroke, name: "Path" });
        store.beginTransaction("Pen");
        store.mutate((d) => {
          Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
        });
        itemId = item.id;
        store.setSelection([item.id]);
        dragIndex = 0;
        isDown = true;
        return;
      }

      const loc = Query.findItem(store.doc, itemId);
      if (!loc || loc.item.type !== "path") return;
      const world = Query.worldTransformAt(loc);
      const path = loc.item.geometry;

      // Close if clicking near the first anchor.
      const firstScreen = ctx.worldToScreen(Mat.applyToPoint(world, path.anchors[0].point));
      if (path.anchors.length >= 2 && Vec.dist(firstScreen, p.screen) < CLOSE_TOL) {
        store.mutate((d) => {
          const l = Query.findItem(d, itemId!);
          if (l && l.item.type === "path") l.item.geometry.closed = true;
        });
        finish(ctx);
        return;
      }

      const local = Mat.applyToPoint(Mat.invert(world), p.world);
      const newIndex = path.anchors.length;
      store.mutate((d) => {
        const l = Query.findItem(d, itemId!);
        if (l && l.item.type === "path") l.item.geometry.anchors.push(makeAnchor(local));
      });
      dragIndex = newIndex;
      isDown = true;
    },

    onPointerMove(p, ctx) {
      cursor = p.world;
      if (isDown && dragIndex != null && itemId) {
        const store = ctx.store;
        const loc = Query.findItem(store.doc, itemId);
        if (loc && loc.item.type === "path") {
          const world = Query.worldTransformAt(loc);
          const localCur = Mat.applyToPoint(Mat.invert(world), p.rawWorld);
          store.mutate((d) => {
            const l = Query.findItem(d, itemId!);
            if (l && l.item.type === "path") {
              const a = l.item.geometry.anchors[dragIndex!];
              if (a) {
                const h = { x: localCur.x - a.point.x, y: localCur.y - a.point.y };
                a.handleOut = h;
                a.handleIn = { x: -h.x, y: -h.y };
              }
            }
          });
        }
      } else {
        ctx.requestRender();
      }
    },

    onPointerUp() {
      isDown = false;
      dragIndex = null;
    },

    onKeyDown(e, ctx) {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(ctx, e.key === "Escape");
      }
    },

    onDeactivate(ctx) {
      finish(ctx);
    },

    renderOverlay(ctx) {
      if (!itemId) return null;
      const loc = Query.findItem(ctx.store.doc, itemId);
      if (!loc || loc.item.type !== "path") return null;
      const world = Query.worldTransformAt(loc);
      const pts = loc.item.geometry.anchors.map((a) => ctx.worldToScreen(Mat.applyToPoint(world, a.point)));
      if (pts.length === 0) return null;
      const last = pts[pts.length - 1];
      const cur = cursor ? ctx.worldToScreen(cursor) : null;
      return (
        <g>
          {cur && !isDown && <line x1={last.x} y1={last.y} x2={cur.x} y2={cur.y} stroke={ACCENT} strokeWidth={1} strokeDasharray="3 3" />}
          {pts.map((pt, i) => (
            <rect key={i} x={pt.x - 3} y={pt.y - 3} width={6} height={6} fill={i === 0 ? "#fff" : ACCENT} stroke={ACCENT} strokeWidth={1} />
          ))}
        </g>
      );
    },
  };
}
