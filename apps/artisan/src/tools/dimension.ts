// tools/dimension - drag out a live dimension/measure annotation

import {
  type Document,
  Ops,
  type Point,
  Query,
  makeDimensionGroup,
} from "../engine";
import type { Tool } from "./types";

export type DimensionToolId = "dimension" | "measure";

export function createDimensionTool(id: DimensionToolId = "dimension"): Tool {
  let itemId: string | null = null;
  let start: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;

  const name = id === "measure" ? "Measure" : "Dimension";
  const build = (doc: Document, cur: Point) =>
    makeDimensionGroup(start, cur, { name, units: doc.meta.units, precision: 1 });

  return {
    id,
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const st = store.getState();
      start = p.world;
      const item = build(st.doc, p.world);
      store.beginTransaction(name);
      store.mutate((d) => {
        Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
      });
      itemId = item.id;
      startDoc = store.doc;
      store.setSelection([item.id]);
    },
    onPointerMove(p, ctx) {
      if (!itemId || !startDoc) return;
      const rebuilt = build(startDoc, p.world);
      ctx.store.mutateFrom(startDoc, (d) => {
        const loc = Query.findItem(d, itemId!);
        if (!loc) return;
        rebuilt.id = itemId!;
        if (rebuilt.dimension) rebuilt.dimension.id = itemId!;
        loc.container[loc.index] = rebuilt;
      });
    },
    onPointerUp(_p, ctx) {
      if (!itemId) return;
      ctx.store.endTransaction();
      ctx.store.setTool("selection");
      itemId = null;
      startDoc = null;
    },
  };
}
