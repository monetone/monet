// ─────────────────────────────────────────────────────────────
// tools/eyedropper — sample appearance (fill + stroke + transparency)
// ─────────────────────────────────────────────────────────────
// Click an object to copy its fill/stroke into the current attributes; if there
// is a selection, the full sampled appearance — including opacity/blend mode,
// like Illustrator's Eyedropper default — is applied to it.

import { Ops, Query, cloneDeep, paintedFill, paintedStroke } from "../engine";
import type { Tool } from "./types";

export function createEyedropperTool(): Tool {
  return {
    id: "eyedropper",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 4 / ctx.zoom);
      if (!hit || hit.leaf.item.type === "group") return;
      const it = hit.leaf.item;
      const fill = cloneDeep(paintedFill(it));
      const stroke = cloneDeep(paintedStroke(it));
      store.setFill(fill);
      store.setStroke(stroke);
      const sel = store.selection;
      if (sel.length) {
        store.transact("Eyedropper", (d) => {
          Ops.Paint.applyAppearance(d, sel, { fill, stroke, appearance: cloneDeep(it.appearance), opacity: it.opacity, blendMode: it.blendMode });
        });
      }
    },
  };
}
