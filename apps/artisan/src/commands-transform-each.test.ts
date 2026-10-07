// ─────────────────────────────────────────────────────────────
// commands-transform-each.test — Transform Each command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Transform ▸ Transform Each transforms each selected
// object around its own centre in one undoable transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(100, 0, 60, 60, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  return { store, a, b };
};
const box = (store: ArtisanStore, id: string) => Query.worldBounds(store.getState().doc, id)!;

describe("commands.transformEach", () => {
  it("scales each object in place by the default 50%, undoable", () => {
    const { store, a, b } = setup();
    commands.transformEach(store);

    const ba = box(store, a.id);
    const bb = box(store, b.id);
    expect([ba.x, ba.y, ba.width, ba.height]).toEqual([10, 10, 20, 20]); // centre (20,20) fixed
    expect([bb.x, bb.y, bb.width, bb.height]).toEqual([115, 15, 30, 30]); // centre (130,30) fixed

    store.undo();
    expect(box(store, a.id).width).toBe(40); // restored in one transaction
    expect(box(store, b.id).width).toBe(60);
  });

  it("honours explicit options (move each)", () => {
    const { store, a } = setup();
    commands.transformEach(store, { scaleX: 1, scaleY: 1, moveX: 5, moveY: 0 });
    const ba = box(store, a.id);
    expect([ba.x, ba.y, ba.width, ba.height]).toEqual([5, 0, 40, 40]);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.transformEach(store);
    expect(store.canUndo).toBe(before);
  });
});
