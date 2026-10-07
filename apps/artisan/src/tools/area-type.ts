// ─────────────────────────────────────────────────────────────
// tools/area-type — Area Type: click a shape, text wraps inside it
// ─────────────────────────────────────────────────────────────
// Uses the clicked shape's bounds as a wrapping text box (rendered via SVG
// foreignObject). The original shape is consumed as the text frame.

import { Mat, Ops, Query, type TextWritingMode, makeText } from "../engine";
import type { Tool } from "./types";

export function createAreaTypeTool(opts: { id?: string; writingMode?: TextWritingMode } = {}): Tool {
  return {
    id: opts.id ?? "area-type",
    cursor: "text",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 6 / ctx.zoom);
      if (!hit) return;
      const wb = Query.worldBounds(store.doc, hit.leaf.item.id);
      if (!wb) return;
      const item = makeText("Area type — text flows and wraps inside the shape bounds.", 0, 0, { fontSize: 18, ...(opts.writingMode ? { writingMode: opts.writingMode } : {}) });
      item.transform = Mat.translation(wb.x, wb.y);
      item.boxWidth = wb.width;
      item.boxHeight = wb.height;
      item.name = opts.writingMode ? "Vertical Area Type" : "Area Type";
      store.transact("Area Type", (d) => {
        Ops.Items.removeItems(d, [hit.leaf.item.id]);
        const layer = Ops.Items.activeLayer(d, store.getState().activeLayerId);
        layer.items.push(item);
      });
      store.setSelection([item.id]);
    },
  };
}
