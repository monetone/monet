// ─────────────────────────────────────────────────────────────
// commands-select-inverse.test — Select ▸ Inverse (parity)
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore driven through commands.selectInverse — the
// selection flips to the previously-unselected objects, and inverting twice
// returns to the original.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const items = [
    makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) }),
    makeRect(50, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 220, 0)) }),
    makeRect(100, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) }),
  ];
  items.forEach((it) => doc.layers[0].items.push(it));
  store.replaceDoc(doc, { markClean: true });
  return { store, ids: items.map((i) => i.id) };
};

describe("commands.selectInverse", () => {
  it("flips the selection to the unselected objects", () => {
    const { store, ids } = setup();
    store.setSelection([ids[0]]);
    commands.selectInverse(store);
    expect(store.getState().selection.slice().sort()).toEqual([ids[1], ids[2]].sort());
  });

  it("inverting twice returns to the original selection", () => {
    const { store, ids } = setup();
    store.setSelection([ids[0]]);
    commands.selectInverse(store); // → {1,2}
    commands.selectInverse(store); // → {0}
    expect(store.getState().selection).toEqual([ids[0]]);
  });

  it("from an empty selection it selects all selectable objects", () => {
    const { store, ids } = setup();
    store.clearSelection();
    commands.selectInverse(store);
    expect(store.getState().selection.slice().sort()).toEqual(ids.slice().sort());
  });
});
