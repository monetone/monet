// ─────────────────────────────────────────────────────────────
// tools/symbolism — Shifter / Scruncher / Sizer / Spinner / Stainer / Styler
// ─────────────────────────────────────────────────────────────
// Brushes that modify the instances (children) of selected Symbol Set groups
// within a radius of the cursor.

import { Mat, type Item, type Point, Query, Shapes, mix, type RGBA, Vec, cloneDeep, paintedFill, setPrimaryFill, setPrimaryStroke } from "../engine";
import type { Tool } from "./types";

export type SymbolismKind = "shifter" | "scruncher" | "sizer" | "spinner" | "stainer" | "styler";

const RADIUS_PX = 60;

/** Every painted leaf under `item` — a symbol instance is a group, so its paint
 *  is one or more levels down rather than on the child itself. */
const eachPaintable = (item: Item, fn: (leaf: Item) => void): void => {
  if (item.type === "group") {
    for (const c of item.children) eachPaintable(c, fn);
    return;
  }
  fn(item);
};

const childCenter = (child: Item): Point => {
  const b = Shapes.localBounds(child);
  return Mat.applyToPoint(child.transform, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
};

export function createSymbolismTool(kind: SymbolismKind): Tool {
  let groupIds: string[] = [];
  let started = false;
  let last: Point = { x: 0, y: 0 };

  return {
    id: kind,
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      groupIds = ctx.store.selection.filter((id) => {
        const it = Query.getItem(ctx.store.doc, id);
        return it?.type === "group";
      });
      started = false;
      last = p.world;
    },
    onPointerMove(p, ctx) {
      if (!groupIds.length) return;
      const store = ctx.store;
      if (!started) {
        store.beginTransaction(kind.charAt(0).toUpperCase() + kind.slice(1));
        started = true;
      }
      const radiusWorld = RADIUS_PX / ctx.zoom;
      const worldDelta = { x: p.world.x - last.x, y: p.world.y - last.y };
      const fill = store.getState().fill;
      const stroke = store.getState().stroke;

      store.mutate((d) => {
        for (const gid of groupIds) {
          const loc = Query.findItem(d, gid);
          if (!loc || loc.item.type !== "group") continue;
          const groupWorld = Query.worldTransformAt(loc);
          const inv = Mat.invert(groupWorld);
          for (const child of loc.item.children) {
            const cWorld = Mat.applyToPoint(groupWorld, childCenter(child));
            const dist = Vec.dist(cWorld, p.world);
            if (dist >= radiusWorld) continue;
            const t = 1 - dist / radiusWorld;
            const centerG = childCenter(child);
            if (kind === "shifter") {
              const gd = Mat.applyToVector(inv, { x: worldDelta.x * t, y: worldDelta.y * t });
              child.transform = Mat.mul(Mat.translation(gd.x, gd.y), child.transform);
            } else if (kind === "scruncher") {
              const pull = Mat.applyToVector(inv, { x: (p.world.x - cWorld.x) * 0.15 * t, y: (p.world.y - cWorld.y) * 0.15 * t });
              child.transform = Mat.mul(Mat.translation(pull.x, pull.y), child.transform);
            } else if (kind === "sizer") {
              const f = 1 + 0.05 * t;
              child.transform = Mat.mul(Mat.aroundPoint(centerG, Mat.scaling(f, f)), child.transform);
            } else if (kind === "spinner") {
              child.transform = Mat.mul(Mat.aroundPoint(centerG, Mat.rotation(0.12 * t)), child.transform);
            } else if (kind === "stainer") {
              // Every symbol INSTANCE is a group (makeSymbolInstance returns a
              // GroupItem holding the symbol's artwork), so the paint lives on
              // its leaves — bailing on groups skipped every instance there is.
              eachPaintable(child, (leaf) => {
                const current = paintedFill(leaf);
                if (current.type === "solid" && fill.type === "solid") {
                  setPrimaryFill(leaf, { type: "solid", color: mix(current.color, fill.color as RGBA, 0.2 * t) });
                }
              });
            } else if (kind === "styler") {
              eachPaintable(child, (leaf) => {
                setPrimaryFill(leaf, cloneDeep(fill));
                setPrimaryStroke(leaf, cloneDeep(stroke));
              });
            }
          }
        }
      });
      last = p.world;
    },
    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      started = false;
      groupIds = [];
    },
  };
}
