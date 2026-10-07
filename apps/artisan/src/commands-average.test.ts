// ─────────────────────────────────────────────────────────────
// commands-average.test — Object ▸ Path ▸ Average (parity)
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore with an anchor selection, driven through
// commands.average. Must read the live anchorSelection, average in one undoable
// transaction, and no-op when fewer than 2 anchors are selected.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";

const pt = (store: ArtisanStore, id: string, i: number) =>
  (Query.getItem(store.getState().doc, id) as { geometry: { anchors: { point: { x: number; y: number } }[] } }).geometry.anchors[i].point;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 40 })] });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, id: p.id };
};

describe("commands — Average", () => {
  it('"both" collapses the selected anchors (one undoable transaction)', () => {
    const { store, id } = setup();
    store.setAnchorSelection({ [id]: [0, 1] });
    commands.average(store, "both");
    expect(pt(store, id, 0)).toEqual({ x: 50, y: 20 });
    expect(pt(store, id, 1)).toEqual({ x: 50, y: 20 });
    store.undo();
    expect(pt(store, id, 0)).toEqual({ x: 0, y: 0 }); // restored
    expect(pt(store, id, 1)).toEqual({ x: 100, y: 40 });
  });

  it('"horizontal" and "vertical" align on the respective axis', () => {
    const h = setup();
    h.store.setAnchorSelection({ [h.id]: [0, 1] });
    commands.average(h.store, "horizontal");
    expect(pt(h.store, h.id, 0)).toEqual({ x: 0, y: 20 });
    expect(pt(h.store, h.id, 1)).toEqual({ x: 100, y: 20 });

    const v = setup();
    v.store.setAnchorSelection({ [v.id]: [0, 1] });
    commands.average(v.store, "vertical");
    expect(pt(v.store, v.id, 0)).toEqual({ x: 50, y: 0 });
    expect(pt(v.store, v.id, 1)).toEqual({ x: 50, y: 40 });
  });

  it("no-op when fewer than 2 anchors are selected", () => {
    const { store, id } = setup();
    store.setAnchorSelection({ [id]: [0] });
    const before = store.canUndo;
    commands.average(store, "both");
    expect(store.canUndo).toBe(before); // nothing transacted
    expect(pt(store, id, 0)).toEqual({ x: 0, y: 0 });
  });
});
