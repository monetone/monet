// ─────────────────────────────────────────────────────────────
// tools/symbol-sprayer — spray linked symbol instances
// ─────────────────────────────────────────────────────────────
// A pragmatic Symbol Sprayer baseline: selected artwork is captured as a
// document-backed symbol definition, then randomized linked instances are
// scattered into a single Symbol Set group. Selecting an existing symbol instance
// reuses that definition instead of creating a duplicate.

import { type Document, type Item, Mat, Ops, type Point, Query, Shapes, Vec, makeGroup, type SymbolDefinition } from "../engine";
import type { Tool } from "./types";

export function createSymbolSprayerTool(): Tool {
  let symbolId: string | null = null;
  let groupId: string | null = null;
  let last: Point | null = null;
  let started = false;

  const itemCenter = (it: Item): Point => {
    const b = Shapes.localBounds(it);
    return Mat.applyToPoint(it.transform, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  };

  const definitionCenter = (definition: SymbolDefinition): Point => {
    if (!definition.items.length) return { x: 0, y: 0 };
    const centers = definition.items.map(itemCenter);
    return {
      x: centers.reduce((sum, center) => sum + center.x, 0) / centers.length,
      y: centers.reduce((sum, center) => sum + center.y, 0) / centers.length,
    };
  };

  const selectedSymbolId = (doc: Document, selection: string[]): string | null => {
    for (const id of selection) {
      const item = Query.getItem(doc, id);
      if (item?.type === "group" && item.symbolInstance && Ops.Symbols.getSymbolDefinition(doc, item.symbolInstance.symbolId)) {
        return item.symbolInstance.symbolId;
      }
    }
    return null;
  };

  const sprayOne = (ctx: { store: { mutate: (fn: (d: Document) => void) => void } }, world: Point) => {
    ctx.store.mutate((d) => {
      const g = Query.findItem(d, groupId!);
      if (!g || g.item.type !== "group") return;
      const definition = symbolId ? Ops.Symbols.getSymbolDefinition(d, symbolId) : null;
      if (!definition) return;
      const jitter = { x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 24 };
      const target = { x: world.x + jitter.x, y: world.y + jitter.y };
      const c = definitionCenter(definition);
      const instance = Ops.Symbols.makeSymbolInstance(definition, {
        name: definition.name,
        transform: Mat.translation(target.x - c.x, target.y - c.y),
      });
      g.item.children.push(instance);
    });
  };

  return {
    id: "symbol-sprayer",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const st = store.getState();
      if (!st.selection.length) return;
      store.beginTransaction("Symbol Spray");
      let createdGroupId: string | null = null;
      let activeSymbolId: string | null = selectedSymbolId(st.doc, st.selection);
      store.mutate((d) => {
        if (!activeSymbolId) {
          const result = Ops.Symbols.createSymbolFromSelection(d, st.selection, `Sprayed Symbol ${(d.symbols?.length ?? 0) + 1}`);
          activeSymbolId = result?.definition.id ?? null;
        }
        if (!activeSymbolId) return;
        const g = makeGroup([], { name: "Symbol Set" });
        createdGroupId = g.id;
        Ops.Items.insertNew(d, g, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
      });
      if (!activeSymbolId || !createdGroupId) {
        store.endTransaction();
        return;
      }
      symbolId = activeSymbolId;
      groupId = createdGroupId;
      started = true;
      last = p.world;
      sprayOne(ctx, p.world);
    },
    onPointerMove(p, ctx) {
      if (!started || !last) return;
      if (Vec.dist(last, p.world) < 28 / ctx.zoom) return;
      last = p.world;
      sprayOne(ctx, p.world);
    },
    onPointerUp(_p, ctx) {
      if (started) {
        ctx.store.endTransaction();
        if (groupId) ctx.store.setSelection([groupId]);
      }
      started = false;
      groupId = null;
      symbolId = null;
      last = null;
    },
  };
}
