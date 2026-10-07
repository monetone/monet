// ─────────────────────────────────────────────────────────────
// tools/shapes — shape-creation tools (rect, ellipse, polygon, star, line)
// ─────────────────────────────────────────────────────────────
// The shape is created on pointer-down and resized live on drag, so the live
// document itself is the preview (no separate overlay needed).

import {
  type Document,
  type Item,
  Mat,
  Ops,
  type Point,
  Query,
  makeEllipse,
  makeLine,
  makePolygon,
  makeRect,
  makeStar,
} from "../engine";
import { constrainAngle } from "./snap";
import type { Tool, ToolContext, ToolPointer } from "./types";

export type ShapeKind = "rect" | "rounded-rect" | "ellipse" | "polygon" | "star" | "line";

/** Live, user-tunable shape options (driven by the options bar). */
export const shapeOptions = {
  cornerRadius: 12,
  polygonSides: 6,
  starPoints: 5,
  starRatio: 0.5,
};

const SHAPE_CURSOR = "crosshair";

function buildShape(kind: ShapeKind, start: Point, state: { fill: Item["fill"]; stroke: Item["stroke"] }): Item {
  const opts = { fill: state.fill, stroke: state.stroke };
  switch (kind) {
    case "rect":
      return makeRect(start.x, start.y, 1, 1, 0, 0, opts);
    case "rounded-rect":
      return makeRect(start.x, start.y, 1, 1, shapeOptions.cornerRadius, shapeOptions.cornerRadius, opts);
    case "ellipse":
      return makeEllipse(start.x, start.y, 1, 1, opts);
    case "polygon":
      return makePolygon(start.x, start.y, 1, shapeOptions.polygonSides, opts);
    case "star":
      return makeStar(start.x, start.y, 1, shapeOptions.starRatio, shapeOptions.starPoints, opts);
    case "line":
      // A line is stroke-only (Illustrator's Line Segment has no fill); omit the
      // active fill so makeLine defaults to noPaint().
      return makeLine(0, 0, 0, 0, { stroke: opts.stroke, transform: Mat.translation(start.x, start.y) });
  }
}

function resizeShape(item: Item, kind: ShapeKind, start: Point, cur: Point, shift: boolean, alt: boolean) {
  if (kind === "line") {
    if (item.type !== "line") return;
    let end = cur;
    if (shift) {
      const a = constrainAngle(Math.atan2(cur.y - start.y, cur.x - start.x));
      const len = Math.hypot(cur.x - start.x, cur.y - start.y);
      end = { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
    }
    item.x2 = end.x - start.x;
    item.y2 = end.y - start.y;
    // line local origin is start; transform already translates to start
    item.x1 = 0;
    item.y1 = 0;
    return;
  }

  if (kind === "polygon" || kind === "star") {
    const r = Math.max(1, Math.hypot(cur.x - start.x, cur.y - start.y));
    if (item.type === "polygon") item.radius = r;
    if (item.type === "star") {
      item.radius1 = r;
      item.radius2 = r * shapeOptions.starRatio;
    }
    // center stays at start (transform = translation(start))
    return;
  }

  // rect / rounded-rect / ellipse: bounding box from start→cur
  let x = start.x;
  let y = start.y;
  let w = Math.abs(cur.x - start.x);
  let h = Math.abs(cur.y - start.y);
  if (shift) {
    const m = Math.max(w, h);
    w = m;
    h = m;
  }
  if (alt) {
    // draw from center
    w *= 2;
    h *= 2;
    x = start.x - w / 2;
    y = start.y - h / 2;
  } else {
    x = cur.x < start.x ? start.x - w : start.x;
    y = cur.y < start.y ? start.y - h : start.y;
  }
  if (item.type === "rect" || item.type === "ellipse" || item.type === "image") {
    item.width = Math.max(1, w);
    item.height = Math.max(1, h);
    item.transform = { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
  }
}

export function createShapeTool(kind: ShapeKind): Tool {
  let id: string | null = null;
  let start: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;
  let dragged = false;

  return {
    id: kind,
    cursor: SHAPE_CURSOR,

    onPointerDown(p, ctx) {
      const { store } = ctx;
      start = p.world;
      dragged = false;
      const st = store.getState();
      const item = buildShape(kind, start, { fill: st.fill, stroke: st.stroke });
      id = item.id;
      store.beginTransaction(`Draw ${kind}`);
      store.mutate((d) => Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget }));
      startDoc = store.doc;
      store.setSelection([item.id]);
    },

    onPointerMove(p, ctx) {
      if (!id || !startDoc) return;
      dragged = true;
      ctx.store.mutateFrom(startDoc, (d) => {
        const loc = Query.findItem(d, id!);
        if (loc) resizeShape(loc.item, kind, start, p.world, p.shift, p.alt);
      });
    },

    onPointerUp(_p, ctx) {
      const { store } = ctx;
      if (id && !dragged) {
        // Click without drag → default-sized shape.
        store.mutateFrom(startDoc!, (d) => {
          const loc = Query.findItem(d, id!);
          if (loc) {
            const def: Point = { x: start.x + 100, y: start.y + 100 };
            resizeShape(loc.item, kind, start, def, false, false);
          }
        });
      }
      store.endTransaction();
      store.setTool("selection");
      id = null;
      startDoc = null;
    },
  };
}
