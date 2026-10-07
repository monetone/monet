// panels-appearance.test — Appearance panel store transactions

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, defaultStroke, makeDocument, makeRect, rgba, solid } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Appearance");
  const rect = makeRect(0, 0, 40, 40, 0, 0, {
    fill: solid(rgba(210, 0, 0)),
    stroke: defaultStroke(solid(rgba(0, 0, 0))),
  });
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, rect };
};

describe("Appearance panel transactions", () => {
  it("adds and edits stacked appearance entries through undoable transactions", () => {
    const { store, rect } = setup();
    store.setFill(solid(rgba(0, 0, 220)));
    let fillId = "";

    store.transact("New Appearance Fill", (doc) => {
      fillId = Ops.Appearance.addFill(doc, store.getState().selection, store.getState().fill, { name: "Panel Fill" })[0].id;
    });

    store.transact("Edit Appearance", (doc) => {
      Ops.Appearance.updateEntry(doc, store.getState().selection, fillId, { opacity: 0.35, visible: false });
    });

    let item = Query.getItem(store.getState().doc, rect.id)!;
    expect(item.appearance?.entries.map((entry) => entry.name)).toEqual(["Fill", "Stroke", "Panel Fill"]);
    expect(item.appearance?.entries[2]).toMatchObject({ opacity: 0.35, visible: false });

    store.undo();
    item = Query.getItem(store.getState().doc, rect.id)!;
    expect(item.appearance?.entries[2]).not.toHaveProperty("visible");
  });

  it("reorders and deletes appearance entries while preserving undo", () => {
    const { store, rect } = setup();
    let fillId = "";
    store.transact("New Appearance Fill", (doc) => {
      fillId = Ops.Appearance.addFill(doc, store.getState().selection, solid(rgba(0, 120, 220)), { name: "Top Fill" })[0].id;
    });

    store.transact("Move Appearance Entry", (doc) => {
      Ops.Appearance.moveEntry(doc, store.getState().selection, fillId, "down");
    });
    expect(Query.getItem(store.getState().doc, rect.id)!.appearance?.entries.map((entry) => entry.name)).toEqual(["Fill", "Top Fill", "Stroke"]);

    store.transact("Delete Appearance Entry", (doc) => {
      Ops.Appearance.deleteEntry(doc, store.getState().selection, fillId);
    });
    expect(Query.getItem(store.getState().doc, rect.id)!.appearance?.entries.map((entry) => entry.name)).toEqual(["Fill", "Stroke"]);

    store.undo();
    expect(Query.getItem(store.getState().doc, rect.id)!.appearance?.entries.map((entry) => entry.name)).toEqual(["Fill", "Top Fill", "Stroke"]);
  });
});
