// ─────────────────────────────────────────────────────────────
// panels-layers.test — Layers panel hide/lock deselects (parity)
// ─────────────────────────────────────────────────────────────
// Integration: drive a real ArtisanStore the way the Layers panel does — toggle a
// layer/object's visibility or lock, then prune the selection with
// Query.selectableIds. Illustrator deselects objects when you hide or lock them.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const RED = rgba(220, 0, 0);
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r, layerId: doc.layers[0].id };
};
// Mirrors the panel: a doc edit transaction, then a selection prune.
const prune = (store: ArtisanStore) => {
  const next = Query.selectableIds(store.getState().doc, store.getState().selection);
  if (next.length !== store.getState().selection.length) store.setSelection(next);
};

describe("Layers panel — hiding/locking deselects (integration)", () => {
  it("hiding the object's layer clears the selection", () => {
    const { store, layerId } = setup();
    store.transact("Toggle Layer", (d) => {
      d.layers.find((l) => l.id === layerId)!.visible = false;
    });
    prune(store);
    expect(store.getState().selection).toEqual([]);
  });

  it("locking the object's layer clears the selection", () => {
    const { store, layerId } = setup();
    store.transact("Lock Layer", (d) => {
      d.layers.find((l) => l.id === layerId)!.locked = true;
    });
    prune(store);
    expect(store.getState().selection).toEqual([]);
  });

  it("hiding the object itself clears the selection", () => {
    const { store, r } = setup();
    store.transact("Toggle Visibility", (d) => {
      Query.getItem(d, r.id)!.visible = false;
    });
    prune(store);
    expect(store.getState().selection).toEqual([]);
  });

  it("locking the object itself clears the selection but keeps it drawn", () => {
    const { store, r } = setup();
    store.transact("Lock", (d) => {
      Query.getItem(d, r.id)!.locked = true;
    });
    prune(store);
    expect(store.getState().selection).toEqual([]);
    const it = Query.getItem(store.getState().doc, r.id)!;
    expect(it.locked).toBe(true);
    expect(it.visible).toBe(true); // locked != hidden — the object stays drawn
  });

  it("hiding an UNRELATED layer leaves the selection intact", () => {
    const { store, r } = setup();
    // add a second, empty layer and hide it
    store.transact("New Layer", (d) => {
      d.layers.push({ id: "L2", name: "Layer 2", color: "#888", visible: false, locked: false, opacity: 1, blendMode: "normal", template: false, items: [] });
    });
    prune(store);
    expect(store.getState().selection).toEqual([r.id]); // unchanged
  });
});
