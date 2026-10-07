// ─────────────────────────────────────────────────────────────
// panels-brushes.test — Brushes panel store transactions
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, defaultStroke, makeDocument, makeRect, noPaint, rgba, solid } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Brushes");
  const rect = makeRect(0, 0, 40, 40, 0, 0, {
    fill: noPaint(),
    stroke: defaultStroke(solid(rgba(0, 0, 0))),
  });
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, rect };
};

describe("Brushes panel transactions", () => {
  it("creates, selects, edits, and applies a brush through undoable transactions", () => {
    const { store, rect } = setup();
    let brushId = "";

    store.transact("New Brush", (doc) => {
      brushId = Ops.Brushes.addCalligraphicBrush(doc, { name: "Panel Brush", size: 18 }).id;
    });
    store.setActiveBrush(brushId);

    expect(store.getState().activeBrushId).toBe(brushId);
    expect(Query.brushDefinitionEntries(store.getState().doc).map((entry) => entry.brush.name)).toContain("Panel Brush");

    store.transact("Edit Brush", (doc) => {
      Ops.Brushes.updateCalligraphicBrush(doc, brushId, { size: 26, angle: 5 });
    });

    store.transact("Apply Brush", (doc) => {
      Ops.Brushes.applyBrushToItems(doc, store.getState().selection, brushId);
    });

    let item = Query.getItem(store.getState().doc, rect.id);
    expect(item?.stroke.width).toBe(26);
    expect(item?.brush?.brushName).toBe("Panel Brush");
    expect(Query.brushDefinitionEntries(store.getState().doc).find((entry) => entry.brush.id === brushId)?.usageCount).toBe(1);

    store.undo();
    item = Query.getItem(store.getState().doc, rect.id);
    expect(item?.brush).toBeUndefined();
  });

  it("deletes a non-default brush while preserving at least one brush", () => {
    const { store } = setup();
    let brushId = "";
    store.transact("New Brush", (doc) => {
      brushId = Ops.Brushes.addCalligraphicBrush(doc, { name: "Temporary" }).id;
    });
    store.setActiveBrush(brushId);

    store.transact("Delete Brush", (doc) => {
      Ops.Brushes.deleteBrushDefinition(doc, brushId);
    });
    store.setActiveBrush(store.getState().doc.brushes?.[0]?.id ?? null);

    expect(Query.brushDefinitionEntries(store.getState().doc)).toHaveLength(1);
    expect(Query.brushDefinitionEntries(store.getState().doc)[0].brush.name).toBe("Basic Calligraphic");
  });
});
