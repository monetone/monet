// ─────────────────────────────────────────────────────────────
// commands-layers.test — Layers panel New / Duplicate / Delete (command path)
// ─────────────────────────────────────────────────────────────
// The Layers panel toolbar buttons call commands.newLayer / duplicateLayer /
// deleteLayer: each is one undoable step that also keeps the active layer (and
// the selection) coherent.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeLayer, makeRect, solid, rgba } from "./engine";

const RED = solid(rgba(220, 0, 0, 1));
const layerCount = (store: ArtisanStore) => store.getState().doc.layers.length;
const active = (store: ArtisanStore) => store.getState().activeLayerId;

describe("commands.newLayer", () => {
  it("adds an empty layer above the active one, selects it, undoably", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true }); // 1 layer, active
    commands.newLayer(store);
    expect(layerCount(store)).toBe(2);
    expect(active(store)).toBe(store.getState().doc.layers[1].id); // the new top layer is active
    store.undo();
    expect(layerCount(store)).toBe(1);
  });
});

describe("commands.newLayer", () => {
  it("is one undo step; the active layer resolves to a real layer after undo", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    commands.newLayer(store);
    store.undo();
    expect(layerCount(store)).toBe(1);
    // activeLayerId may now be stale (it lives outside the undo snapshot), but
    // activeLayer() falls back so it always resolves to a layer in the document.
    expect(store.getState().doc.layers.some((l) => l.id === store.activeLayer().id)).toBe(true);
  });
});

describe("commands.duplicateLayer", () => {
  it("duplicates the active layer (its art too) above it and selects the copy", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: RED });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    commands.duplicateLayer(store);
    expect(layerCount(store)).toBe(2);
    const copy = store.getState().doc.layers[1];
    expect(active(store)).toBe(copy.id);
    expect(copy.name).toBe("Layer 1 copy");
    expect(copy.items[0].id).not.toBe(r.id); // a real clone
  });

  it("targets the ACTIVE layer by default, not the top of the stack", () => {
    const store = new ArtisanStore();
    const doc = makeDocument(); // Layer 1 (bottom)
    doc.layers.push(makeLayer("Layer 2")); // top
    store.replaceDoc(doc, { markClean: true }); // active = top
    store.setActiveLayer(doc.layers[0].id); // make the BOTTOM layer active
    commands.duplicateLayer(store);
    expect(layerCount(store)).toBe(3);
    expect(store.getState().doc.layers[1].name).toBe("Layer 1 copy"); // clone above the bottom source
  });
});

describe("commands.deleteLayer", () => {
  it("deletes the active layer, re-activates a neighbour, and prunes the selection", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const bottomId = doc.layers[0].id;
    const r1 = makeRect(0, 0, 40, 40, 0, 0, { fill: RED });
    doc.layers[0].items.push(r1);
    const top = makeLayer("Layer 2");
    const r2 = makeRect(100, 0, 40, 40, 0, 0, { fill: RED });
    top.items.push(r2);
    doc.layers.push(top);
    store.replaceDoc(doc, { markClean: true }); // active = top
    store.setSelection([r2.id]);
    expect(active(store)).toBe(top.id);

    commands.deleteLayer(store);
    expect(layerCount(store)).toBe(1);
    expect(store.getState().doc.layers[0].id).toBe(bottomId); // the bottom layer remains
    expect(active(store)).toBe(bottomId); // neighbour activated
    expect(store.getState().selection).toEqual([]); // r2's layer is gone ⇒ deselected
  });

  it("deleting a MIDDLE layer activates the layer that slid into the gap", () => {
    const store = new ArtisanStore();
    const doc = makeDocument(); // Layer 1 (bottom)
    const mid = makeLayer("Layer 2");
    const top = makeLayer("Layer 3");
    doc.layers.push(mid, top); // [L1, mid, top]
    store.replaceDoc(doc, { markClean: true });
    store.setActiveLayer(mid.id); // delete from the MIDDLE
    commands.deleteLayer(store);
    expect(layerCount(store)).toBe(2);
    expect(active(store)).toBe(top.id); // top fell into the gap (index 1)
  });

  it("refuses to delete the last remaining layer (no undo entry)", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    const before = store.canUndo;
    commands.deleteLayer(store);
    expect(layerCount(store)).toBe(1);
    expect(store.canUndo).toBe(before);
  });

  it("keeps a still-present item selected after deleting a different layer", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 40, 40, 0, 0, { fill: RED });
    doc.layers[0].items.push(r1); // on the bottom layer
    const top = makeLayer("Layer 2");
    doc.layers.push(top);
    store.replaceDoc(doc, { markClean: true }); // active = empty top layer
    store.setSelection([r1.id]); // an item on the OTHER layer
    commands.deleteLayer(store); // deletes the active (empty) top layer
    expect(layerCount(store)).toBe(1);
    expect(store.getState().selection).toEqual([r1.id]); // still selected
  });
});

describe("commands.flattenArtwork", () => {
  it("merges all layers into the active one, keeps the selection, undoably", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const a0 = makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
    doc.layers[0].items.push(a0); // bottom layer
    const top = makeLayer("Layer 2");
    const a1 = makeRect(20, 0, 10, 10, 0, 0, { fill: RED });
    top.items.push(a1);
    doc.layers.push(top);
    store.replaceDoc(doc, { markClean: true }); // active = top
    store.setSelection([a0.id, a1.id]);

    commands.flattenArtwork(store);
    expect(layerCount(store)).toBe(1);
    expect(active(store)).toBe(top.id); // survivor = the active layer
    expect(store.getState().doc.layers[0].items.map((i) => i.id)).toEqual([a0.id, a1.id]); // bottom→top order
    expect(store.getState().selection).toEqual([a0.id, a1.id]); // items kept their ids ⇒ selection survives

    store.undo();
    expect(layerCount(store)).toBe(2);
  });

  it("flattens 3 layers through the store/Immer path and undoes in one step", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.layers[0].items.push(makeRect(0, 0, 10, 10, 0, 0, { fill: RED }));
    const mid = makeLayer("Layer 2");
    mid.items.push(makeRect(20, 0, 10, 10, 0, 0, { fill: RED }));
    const top = makeLayer("Layer 3");
    top.items.push(makeRect(40, 0, 10, 10, 0, 0, { fill: RED }));
    doc.layers.push(mid, top);
    store.replaceDoc(doc, { markClean: true }); // active = top
    commands.flattenArtwork(store);
    expect(layerCount(store)).toBe(1);
    expect(store.getState().doc.layers[0].items.length).toBe(3); // all three items survive
    store.undo();
    expect(layerCount(store)).toBe(3); // single undo restores the stack
  });

  it("is a no-op for a single-layer document (no undo entry)", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    const before = store.canUndo;
    commands.flattenArtwork(store);
    expect(layerCount(store)).toBe(1);
    expect(store.canUndo).toBe(before);
  });
});

describe("commands.reverseLayerOrder", () => {
  const build = (n: number) => {
    const store = new ArtisanStore();
    const doc = makeDocument(); // starts with one layer
    for (let i = 1; i < n; i++) doc.layers.push(makeLayer(`L${i}`));
    store.replaceDoc(doc, { markClean: true });
    return store;
  };
  const ids = (store: ArtisanStore) => store.getState().doc.layers.map((l) => l.id);

  it("reverses the layer stacking order, undoably", () => {
    const store = build(3);
    const before = ids(store);
    commands.reverseLayerOrder(store);
    expect(ids(store)).toEqual([...before].reverse());

    store.undo();
    expect(ids(store)).toEqual(before);
  });

  it("is a no-op (no undo entry) with a single layer", () => {
    const store = build(1);
    const before = store.canUndo;
    commands.reverseLayerOrder(store);
    expect(store.canUndo).toBe(before);
  });
});
