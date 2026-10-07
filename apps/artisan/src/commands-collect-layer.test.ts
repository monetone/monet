// ─────────────────────────────────────────────────────────────
// commands-collect-layer.test — Layers panel ▸ Collect in New Layer (command)
// ─────────────────────────────────────────────────────────────
// commands.collectInNewLayer moves the selection into a new active layer in one
// undoable step, keeps it selected, and is a guarded no-op without a selection.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) });
  const b = makeRect(60, 0, 50, 50, 0, 0, { fill: solid(BLUE) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  return { store, a, b };
};
const layers = (store: ArtisanStore) => store.getState().doc.layers;

describe("commands.collectInNewLayer", () => {
  it("collects the selection into a new active layer, kept selected, undoably", () => {
    const { store, a, b } = setup();
    commands.collectInNewLayer(store);
    expect(layers(store).length).toBe(2);
    const activeId = store.getState().activeLayerId;
    const active = layers(store).find((l) => l.id === activeId)!;
    expect(active.items.map((i) => i.id)).toEqual([a.id, b.id]); // moved into the new (active) layer
    expect([...store.getState().selection].sort()).toEqual([a.id, b.id].sort()); // still selected
    store.undo();
    expect(layers(store).length).toBe(1); // layer + move reverted
    expect(layers(store)[0].items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("is a no-op (no undo, no dirty) when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.collectInNewLayer(store);
    expect(store.canUndo).toBe(before);
    expect(store.getState().dirty).toBe(false);
    expect(layers(store).length).toBe(1);
  });
});
