// ─────────────────────────────────────────────────────────────
// commands-add-anchor-points.test — Object ▸ Path ▸ Add Anchor Points (parity)
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore driven through commands.addAnchorPoints. It
// must densify every selected path in one undoable transaction and keep the
// selection (Illustrator modifies the path in place — no new objects).

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";

const square = () => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })],
});
const nAnchors = (store: ArtisanStore, id: string) =>
  (Query.getItem(store.getState().doc, id) as { geometry: { anchors: unknown[] } }).geometry.anchors.length;

describe("commands — Add Anchor Points", () => {
  const setup = () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const a = makePath(square());
    const b = makePath(square());
    doc.layers[0].items.push(a, b);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([a.id, b.id]);
    return { store, ids: [a.id, b.id] as const };
  };

  it("doubles the anchors of every selected path and keeps the selection", () => {
    const { store, ids } = setup();
    commands.addAnchorPoints(store);
    expect(nAnchors(store, ids[0])).toBe(8);
    expect(nAnchors(store, ids[1])).toBe(8);
    expect(store.getState().selection).toEqual([ids[0], ids[1]]); // selection preserved
  });

  it("is a single undoable transaction", () => {
    const { store, ids } = setup();
    commands.addAnchorPoints(store);
    expect(nAnchors(store, ids[0])).toBe(8);
    store.undo();
    expect(nAnchors(store, ids[0])).toBe(4); // back to the original square
    expect(nAnchors(store, ids[1])).toBe(4);
  });

  it("no selection → no-op", () => {
    const { store } = setup();
    store.setSelection([]);
    const before = store.canUndo;
    commands.addAnchorPoints(store);
    expect(store.canUndo).toBe(before); // nothing transacted
  });
});
