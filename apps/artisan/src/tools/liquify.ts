// ─────────────────────────────────────────────────────────────
// tools/liquify — Warp / Twirl / Pucker / Bloat brushes
// ─────────────────────────────────────────────────────────────
// Brushes that deform path anchors near the cursor. Live shapes are converted
// to editable paths on first use. Effects accumulate while dragging.

import { Mat, Ops, type Point, Query } from "../engine";
import type { Tool } from "./types";

export type LiquifyKind = "warp" | "twirl" | "pucker" | "bloat" | "crystallize" | "scallop" | "wrinkle";

const RADIUS_PX = 40;

export function createLiquifyTool(kind: LiquifyKind): Tool {
  let ids: string[] = [];
  let started = false;
  let last: Point = { x: 0, y: 0 };

  return {
    id: kind,
    cursor: "crosshair",

    onPointerDown(p, ctx) {
      const store = ctx.store;
      ids = store.selection.length ? store.selection.slice() : [];
      if (!ids.length) {
        const hit = Query.hitTest(store.doc, p.rawWorld, 4 / ctx.zoom);
        if (hit) {
          ids = [hit.target.item.id];
          store.setSelection(ids);
        }
      }
      started = false;
      last = p.rawWorld;
    },

    onPointerMove(p, ctx) {
      if (!ids.length) return;
      const store = ctx.store;
      if (!started) {
        store.beginTransaction(label(kind));
        store.mutate((d) => {
          for (const id of ids) {
            const loc = Query.findItem(d, id);
            if (loc && loc.item.type !== "path" && loc.item.type !== "compound") Ops.PathEdit.convertToPath(d, id);
          }
        });
        started = true;
      }
      const radiusWorld = RADIUS_PX / ctx.zoom;
      const worldDelta = { x: p.rawWorld.x - last.x, y: p.rawWorld.y - last.y };

      store.mutate((d) => {
        for (const id of ids) {
          const loc = Query.findItem(d, id);
          if (!loc || (loc.item.type !== "path" && loc.item.type !== "compound")) continue;
          const inv = Mat.invert(Query.worldTransformAt(loc));
          const center = Mat.applyToPoint(inv, p.rawWorld);
          const localDelta = Mat.applyToVector(inv, worldDelta);
          const scale = Mat.meanScale(Query.worldTransformAt(loc)) || 1;
          const radius = radiusWorld / scale;
          const fn =
            kind === "warp"
              ? Ops.Liquify.warpFn(localDelta, 1)
              : kind === "twirl"
                ? Ops.Liquify.twirlFn(0.35)
                : kind === "pucker"
                  ? Ops.Liquify.puckerFn(0.2)
                  : kind === "bloat"
                    ? Ops.Liquify.bloatFn(0.2)
                    : kind === "crystallize"
                      ? Ops.Liquify.crystallizeFn(0.3)
                      : kind === "scallop"
                        ? Ops.Liquify.scallopFn(0.3)
                        : Ops.Liquify.wrinkleFn(8 / ctx.zoom);
          Ops.Liquify.liquify(d, id, center, radius, fn);
        }
      });
      last = p.rawWorld;
    },

    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      started = false;
      ids = [];
    },
  };
}

const label = (k: LiquifyKind): string => k.charAt(0).toUpperCase() + k.slice(1);
