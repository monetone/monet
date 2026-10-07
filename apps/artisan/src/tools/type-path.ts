// ─────────────────────────────────────────────────────────────
// tools/type-path — Type on a Path: click a path, text flows along it
// ─────────────────────────────────────────────────────────────
// The clicked path's world-space outline is baked into the text item's `pathD`
// and rendered via SVG <textPath>; the original path is consumed.

import { Ops, Path, Query, Shapes, type TextWritingMode, makeText } from "../engine";
import type { Tool } from "./types";

export function createTypeOnPathTool(opts: { id?: string; writingMode?: TextWritingMode } = {}): Tool {
  return {
    id: opts.id ?? "type-on-path",
    cursor: "text",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 6 / ctx.zoom);
      if (!hit) return;
      const loc = Query.findItem(store.doc, hit.leaf.item.id);
      if (!loc) return;
      const paths = Shapes.localPaths(loc.item);
      if (!paths.length) return;
      const world = Query.worldTransformAt(loc);
      const d = Path.toSVGPath(Path.transform(paths[0], world));

      const item = makeText("Type on a path", 0, 0, { fontSize: 32, ...(opts.writingMode ? { writingMode: opts.writingMode } : {}) });
      item.pathD = d;
      item.name = "Type on Path";
      store.transact("Type on Path", (dd) => {
        Ops.Items.removeItems(dd, [loc.item.id]);
        const layer = Ops.Items.activeLayer(dd, store.getState().activeLayerId);
        layer.items.push(item);
      });
      store.setSelection([item.id]);
    },
  };
}
