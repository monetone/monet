// ─────────────────────────────────────────────────────────────
// tools/gradient-tool — drag to set a fill gradient's direction/extent
// ─────────────────────────────────────────────────────────────
// Maps the drag (world space) into each object's objectBoundingBox-normalized
// gradient endpoints. A solid fill becomes a color→transparent gradient; an
// existing gradient keeps its stops and just re-aims.

import { aimGradient, type Document, type Gradient, Mat, paintedFill, type Point, Query, setPrimaryFill, Shapes } from "../engine";
import type { Tool } from "./types";

const defaultGradient = (): Gradient => ({
  type: "linear",
  stops: [
    { offset: 0, color: { r: 255, g: 255, b: 255, a: 1 } },
    { offset: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
  ],
  x1: 0,
  y1: 0.5,
  x2: 1,
  y2: 0.5,
  cx: 0.5,
  cy: 0.5,
  r: 0.5,
});

export function createGradientTool(): Tool {
  let ids: string[] = [];
  let primaryId: string | null = null;
  let startWorld: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;
  let started = false;

  return {
    id: "gradient",
    cursor: "crosshair",

    onPointerDown(p, ctx) {
      const store = ctx.store;
      let sel = store.selection;
      if (!sel.length) {
        const hit = Query.hitTest(store.doc, p.world, 4 / ctx.zoom);
        if (hit) {
          store.setSelection([hit.target.item.id]);
          sel = store.selection;
        }
      }
      ids = sel.slice();
      primaryId = ids[0] ?? null;
      startWorld = p.world;
      started = false;
    },

    onPointerMove(p, ctx) {
      if (!primaryId) return;
      const store = ctx.store;
      if (!started) {
        store.beginTransaction("Gradient");
        startDoc = store.doc;
        started = true;
      }
      const loc = Query.findItem(startDoc!, primaryId);
      if (!loc) return;
      const world = Query.worldTransformAt(loc);
      const lb = Shapes.localBounds(loc.item);
      const toN = (wp: Point): Point => {
        const lpt = Mat.applyToPoint(Mat.invert(world), wp);
        return { x: lb.width ? (lpt.x - lb.x) / lb.width : 0.5, y: lb.height ? (lpt.y - lb.y) / lb.height : 0.5 };
      };
      const n1 = toN(startWorld);
      const n2 = toN(p.world);

      store.mutateFrom(startDoc!, (d) => {
        for (const id of ids) {
          const l = Query.findItem(d, id);
          if (!l || l.item.type === "group") continue;
          const it = l.item;
          const fill = paintedFill(it);
          let grad: Gradient;
          if (fill.type === "gradient") grad = { ...fill.gradient };
          else if (fill.type === "solid") {
            grad = {
              ...defaultGradient(),
              stops: [
                { offset: 0, color: { ...fill.color, a: 1 } },
                { offset: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
              ],
            };
          } else {
            grad = defaultGradient();
          }
          // Aim the gradient along the drag — linear endpoints AND, for a radial
          // gradient, its centre/radius/focal (otherwise dragging a radial fill
          // would do nothing since it renders from cx/cy/r).
          setPrimaryFill(it, { type: "gradient", gradient: aimGradient(grad, n1, n2) });
        }
      });
    },

    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      started = false;
      primaryId = null;
      startDoc = null;
    },
  };
}
