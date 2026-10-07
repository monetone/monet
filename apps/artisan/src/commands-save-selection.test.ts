// ─────────────────────────────────────────────────────────────
// commands-save-selection.test — Select ▸ Save Selection (parity)
// ─────────────────────────────────────────────────────────────
// Integration: saveSelection snapshots the current selection under an
// auto-incremented name; applySavedSelection restores it (dropping any objects
// that have since been deleted); both no-op sensibly.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const rect = (x: number) => makeRect(x, 0, 40, 40, 0, 0, { fill: solid(rgba(200, 100, 100)) });

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const [a, b, c] = [rect(0), rect(50), rect(100)];
  doc.layers[0].items.push(a, b, c);
  store.replaceDoc(doc, { markClean: true });
  return { store, a, b, c };
};

describe("commands.saveSelection / applySavedSelection", () => {
  it("saves the current selection under an auto-incremented name", () => {
    const { store, a, b } = setup();
    store.setSelection([a.id, b.id]);
    commands.saveSelection(store);
    const saved = store.getState().savedSelections;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Selection 1");
    expect(saved[0].ids.slice().sort()).toEqual([a.id, b.id].sort());

    store.setSelection([a.id]);
    commands.saveSelection(store);
    expect(store.getState().savedSelections.map((s) => s.name)).toEqual(["Selection 1", "Selection 2"]);
  });

  it("re-applies a saved selection", () => {
    const { store, a, c } = setup();
    store.setSelection([a.id, c.id]);
    commands.saveSelection(store);
    store.clearSelection();
    commands.applySavedSelection(store, store.getState().savedSelections[0].id);
    expect(store.getState().selection.slice().sort()).toEqual([a.id, c.id].sort());
  });

  it("drops deleted objects when re-applying", () => {
    const { store, a, b } = setup();
    store.setSelection([a.id, b.id]);
    commands.saveSelection(store);
    const savedId = store.getState().savedSelections[0].id;
    store.setSelection([b.id]);
    commands.delete(store); // b is gone
    commands.applySavedSelection(store, savedId);
    expect(store.getState().selection).toEqual([a.id]); // only the survivor
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    commands.saveSelection(store);
    expect(store.getState().savedSelections).toEqual([]);
  });

  it("applying an unknown id is a no-op", () => {
    const { store, a } = setup();
    store.setSelection([a.id]);
    commands.applySavedSelection(store, "nope");
    expect(store.getState().selection).toEqual([a.id]); // unchanged
  });
});
