// ─────────────────────────────────────────────────────────────
// commands-release-to-layers.test — Layers ▸ Release to Layers (command path)
// ─────────────────────────────────────────────────────────────
// The Layers panel "Release to Layers" button calls commands.releaseToLayers:
// it releases the ACTIVE layer's items onto their own new layers in one undoable
// step, selects the topmost new layer, and no-ops (no undo entry) for <2 items.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const layerCount = (s: ArtisanStore) => s.getState().doc.layers.length;
const active = (s: ArtisanStore) => s.getState().activeLayerId;

const setup = (n: number) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  for (let i = 0; i < n; i++) doc.layers[0].items.push(makeRect(i * 20, 0, 10, 10, 0, 0, { fill: solid(rgba(200, 100, 100)) }));
  store.replaceDoc(doc, { markClean: true }); // single layer is the active one
  return { store, lid: doc.layers[0].id };
};

describe("commands.releaseToLayers", () => {
  it("releases the active layer's 3 items onto 3 new layers, topmost active, undoably", () => {
    const { store, lid } = setup(3);
    commands.releaseToLayers(store);

    expect(layerCount(store)).toBe(4); // source (emptied) + 3 new
    const layers = store.getState().doc.layers;
    expect(layers[0].id).toBe(lid);
    expect(layers[0].items).toHaveLength(0);
    expect(layers.slice(1).every((l) => l.items.length === 1)).toBe(true);
    expect(active(store)).toBe(layers[layers.length - 1].id); // topmost new layer active

    store.undo();
    expect(layerCount(store)).toBe(1);
    expect(store.getState().doc.layers[0].items).toHaveLength(3); // restored
  });

  it("is a no-op (no undo step) when the active layer has fewer than two items", () => {
    const { store } = setup(1);
    const before = store.canUndo;
    commands.releaseToLayers(store);
    expect(layerCount(store)).toBe(1);
    expect(store.canUndo).toBe(before);
  });
});
