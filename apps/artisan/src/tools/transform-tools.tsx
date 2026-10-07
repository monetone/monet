// ─────────────────────────────────────────────────────────────
// tools/transform-tools — Rotate / Scale / Reflect / Shear
// ─────────────────────────────────────────────────────────────
// Interactive transforms around a pivot (selection center by default; a click
// without a drag sets a custom pivot for the next drag). Each frame recomputes
// from the drag-start snapshot so transforms don't compound.

import { type Document, Ops, type Point, Query, Vec } from "../engine";
import { constrainAngle } from "./snap";
import type { Tool, ToolContext, ToolPointer } from "./types";

export type TransformKind = "rotate" | "scale" | "reflect" | "shear";

const ACCENT = "var(--accent-vector, #4a9eff)";

export function createTransformTool(kind: TransformKind): Tool {
  let customPivot: Point | null = null;
  let pivot: Point = { x: 0, y: 0 };
  let startWorld: Point = { x: 0, y: 0 };
  let startAngle = 0;
  let startDist = 1;
  let startDoc: Document | null = null;
  let started = false;
  let duplicated = false;
  let ids: string[] = [];

  const center = (ctx: ToolContext): Point | null => {
    const b = Query.selectionBounds(ctx.store.doc, ctx.store.selection);
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  };

  return {
    id: kind,
    cursor: "crosshair",

    onPointerDown(p, ctx) {
      ids = ctx.store.selection.slice();
      if (!ids.length) return;
      pivot = customPivot ?? center(ctx) ?? p.world;
      startWorld = p.rawWorld;
      started = false;
      duplicated = false;
      startAngle = Math.atan2(p.rawWorld.y - pivot.y, p.rawWorld.x - pivot.x);
      startDist = Math.max(1e-3, Vec.dist(p.rawWorld, pivot));
    },

    onPointerMove(p, ctx) {
      if (!ids.length) return;
      const moved = Vec.dist(p.screen, ctx.worldToScreen(startWorld)) > 3;
      if (!moved && !started) return;
      if (!started) {
        ctx.store.beginTransaction(label(kind));
        // Alt-drag transforms a COPY, leaving the original in place (Illustrator).
        if (p.alt) {
          ctx.store.mutate((d) => {
            ids = Ops.Items.duplicateItems(d, ids, 0, 0);
          });
          duplicated = true;
        }
        startDoc = ctx.store.doc; // base (incl. the copies) for the non-compounding live transform
        started = true;
      }
      const base = startDoc!;
      const cur = p.rawWorld;

      if (kind === "rotate") {
        let delta = Math.atan2(cur.y - pivot.y, cur.x - pivot.x) - startAngle;
        if (p.shift) delta = constrainAngle(delta);
        ctx.store.mutateFrom(base, (d) => Ops.Transform.rotateItems(d, ids, delta, pivot));
      } else if (kind === "scale") {
        const axis = Vec.sub(startWorld, pivot);
        let f = Vec.len(axis) < 1e-3
          ? Vec.dist(cur, pivot) / startDist
          : Vec.dot(Vec.sub(cur, pivot), axis) / (startDist * startDist);
        if (Math.abs(f) < 1e-3) f = Math.sign(f || 1) * 1e-3;
        ctx.store.mutateFrom(base, (d) => Ops.Transform.scaleItems(d, ids, f, f, pivot));
      } else if (kind === "reflect") {
        let axis = Math.atan2(cur.y - pivot.y, cur.x - pivot.x);
        if (p.shift) axis = constrainAngle(axis);
        ctx.store.mutateFrom(base, (d) => Ops.Transform.reflectItems(d, ids, axis, pivot));
      } else {
        // shear: skewX proportional to the angle swept around the pivot
        const delta = Math.atan2(cur.y - pivot.y, cur.x - pivot.x) - startAngle;
        const shear = Math.max(-1.2, Math.min(1.2, delta));
        ctx.store.mutateFrom(base, (d) => Ops.Transform.shearItems(d, ids, shear, 0, pivot));
      }
    },

    onPointerUp(p, ctx) {
      if (started) {
        ctx.store.endTransaction();
        if (duplicated) ctx.store.setSelection(ids); // select the transformed copy
      } else if (ids.length) {
        // A click without a drag sets a custom pivot for the next drag.
        customPivot = p.world;
        ctx.requestRender();
      }
      started = false;
      duplicated = false;
      startDoc = null;
      // `ids` is the drag's guard (`if (!ids.length) return` in onPointerMove).
      // Leaving it armed let a later buttonless HOVER start a fresh transform —
      // outside any transaction, so the result could not even be undone.
      ids = [];
    },

    onDeactivate(ctx) {
      if (started) ctx.store.cancelTransaction();
      started = false;
      duplicated = false;
      startDoc = null;
      ids = [];
      customPivot = null;
    },

    renderOverlay(ctx) {
      if (!ctx.store.selection.length) return null;
      const piv = customPivot ?? center(ctx);
      if (!piv) return null;
      const s = ctx.worldToScreen(piv);
      return (
        <g pointerEvents="none">
          <circle cx={s.x} cy={s.y} r={5} fill="none" stroke={ACCENT} strokeWidth={1.25} />
          <line x1={s.x - 7} y1={s.y} x2={s.x + 7} y2={s.y} stroke={ACCENT} strokeWidth={1} />
          <line x1={s.x} y1={s.y - 7} x2={s.x} y2={s.y + 7} stroke={ACCENT} strokeWidth={1} />
        </g>
      );
    },
  };
}

const label = (k: TransformKind): string =>
  k === "rotate" ? "Rotate" : k === "scale" ? "Scale" : k === "reflect" ? "Reflect" : "Shear";
