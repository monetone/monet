// ─────────────────────────────────────────────────────────────
// commands-layer-template.test — Layers ▸ Template (command path)
// ─────────────────────────────────────────────────────────────
// The Layers panel "Template Layer" button calls commands.toggleLayerTemplate:
// it flips the ACTIVE layer's `template` flag (a dimmed, non-printing reference
// layer) in one undoable step.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeLayer } from "./engine";

const activeLayer = (s: ArtisanStore) => {
  const st = s.getState();
  return st.doc.layers.find((l) => l.id === st.activeLayerId)!;
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument(); // one layer, active
  doc.layers.push(makeLayer("Layer 2"));
  store.replaceDoc(doc, { markClean: true }); // active = top layer (Layer 2)
  return store;
};

describe("commands.toggleLayerTemplate", () => {
  it("toggles the active layer's template flag on, then off, undoably", () => {
    const store = setup();
    expect(activeLayer(store).template).toBe(false);

    commands.toggleLayerTemplate(store);
    expect(activeLayer(store).template).toBe(true);

    commands.toggleLayerTemplate(store);
    expect(activeLayer(store).template).toBe(false);

    store.undo(); // back to template = true
    expect(activeLayer(store).template).toBe(true);
    store.undo(); // back to template = false
    expect(activeLayer(store).template).toBe(false);
  });

  it("only affects the active layer", () => {
    const store = setup();
    const others = store.getState().doc.layers.filter((l) => l.id !== store.getState().activeLayerId);
    commands.toggleLayerTemplate(store);
    expect(activeLayer(store).template).toBe(true);
    for (const o of others) expect(store.getState().doc.layers.find((l) => l.id === o.id)!.template).toBe(false);
  });
});
