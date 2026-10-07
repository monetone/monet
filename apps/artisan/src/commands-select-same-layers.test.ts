// ─────────────────────────────────────────────────────────────
// commands-select-same-layers.test — Select ▸ Object ▸ All on Same Layers
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore driven through commands.selectSameLayers —
// the selection grows to every selectable object on the same layer(s), the
// query is remembered for Reselect, and an empty selection is a no-op.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, makeLayer, solid, rgba } from "./engine";

const rect = (x: number) => makeRect(x, 0, 40, 40, 0, 0, { fill: solid(rgba(200, 100, 100)) });

// L0 = [a, b], L1 = [c, d].
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const [a, b, c, d] = [rect(0), rect(50), rect(100), rect(150)];
  doc.layers[0].items.push(a, b);
  doc.layers.push(makeLayer("Layer 2", [c, d]));
  store.replaceDoc(doc, { markClean: true });
  return { store, a, b, c, d };
};
const selSorted = (store: ArtisanStore) => store.getState().selection.slice().sort();

describe("commands.selectSameLayers", () => {
  it("selects every object on the selection's layer", () => {
    const { store, a, b } = setup();
    store.setSelection([a.id]);
    commands.selectSameLayers(store);
    expect(selSorted(store)).toEqual([a.id, b.id].sort());
  });

  it("does not reach objects on other layers", () => {
    const { store, a, c, d } = setup();
    store.setSelection([a.id]);
    commands.selectSameLayers(store);
    expect(store.getState().selection).not.toContain(c.id);
    expect(store.getState().selection).not.toContain(d.id);
  });

  it("remembers the query so Reselect re-runs it after the selection changes", () => {
    const { store, a, c, d } = setup();
    store.setSelection([a.id]);
    commands.selectSameLayers(store); // → {a,b}, query remembered
    expect(store.getState().lastSelectQuery).toEqual({ kind: "same-layers" });

    store.setSelection([c.id]); // move to the other layer
    commands.reselect(store); // re-run "All on Same Layers" against the new selection
    expect(selSorted(store)).toEqual([c.id, d.id].sort());
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    commands.selectSameLayers(store);
    expect(store.getState().selection).toEqual([]);
    expect(store.getState().lastSelectQuery).toBeNull();
  });
});
