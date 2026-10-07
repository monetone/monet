// ─────────────────────────────────────────────────────────────
// panels-symbols.test — Symbols panel store transactions
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, makeDocument, makeRect } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Symbols");
  const rect = makeRect(0, 0, 40, 40);
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, rect };
};

describe("Symbols panel transactions", () => {
  it("creates and places symbols through undoable transactions", () => {
    const { store } = setup();

    store.transact("New Symbol", (doc) => {
      Ops.Symbols.createSymbolFromSelection(doc, store.getState().selection, "Panel Symbol", { replaceSelection: true });
    });

    let state = store.getState();
    const symbol = Query.symbolDefinitionEntries(state.doc)[0].symbol;
    const firstInstance = Query.symbolInstanceEntries(state.doc)[0];
    expect(symbol.name).toBe("Panel Symbol");
    expect(firstInstance.symbolName).toBe("Panel Symbol");
    expect(state.dirty).toBe(true);

    store.transact("Place Symbol", (doc) => {
      Ops.Symbols.placeSymbolInstance(doc, symbol.id, { layerId: state.activeLayerId });
    });

    state = store.getState();
    expect(Query.symbolDefinitionEntries(state.doc)[0].instanceCount).toBe(2);

    store.undo();
    expect(Query.symbolDefinitionEntries(store.getState().doc)[0].instanceCount).toBe(1);
  });

  it("breaks selected symbol links without deleting the symbol definition", () => {
    const { store } = setup();
    store.transact("New Symbol", (doc) => {
      Ops.Symbols.createSymbolFromSelection(doc, store.getState().selection, "Breakable", { replaceSelection: true });
    });
    const instanceId = Query.symbolInstanceEntries(store.getState().doc)[0].itemId;
    store.setSelection([instanceId]);

    store.transact("Break Symbol Link", (doc) => {
      Ops.Symbols.breakLink(doc, store.getState().selection);
    });

    expect(Query.symbolInstanceEntries(store.getState().doc)).toHaveLength(0);
    expect(Query.symbolDefinitionEntries(store.getState().doc)).toHaveLength(1);

    store.undo();
    expect(Query.symbolInstanceEntries(store.getState().doc)).toHaveLength(1);
  });
});
