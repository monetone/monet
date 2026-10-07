// ─────────────────────────────────────────────────────────────
// commands-simplify.test — Simplify command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Path ▸ Simplify reduces the selection's anchor count in
// one undoable transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  // open line with two redundant collinear midpoints
  const p = makePath(
    { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 33, y: 0 }), anchor({ x: 66, y: 0 }), anchor({ x: 100, y: 0 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const count = (store: ArtisanStore, id: string) => {
  const it = Query.getItem(store.getState().doc, id)!;
  return it.type === "path" ? it.geometry.anchors.length : -1;
};

describe("commands.simplify", () => {
  it("reduces the anchor count, undoable", () => {
    const { store, p } = setup();
    expect(count(store, p.id)).toBe(4);
    commands.simplify(store, 1);
    expect(count(store, p.id)).toBe(2); // collinear midpoints removed

    store.undo();
    expect(count(store, p.id)).toBe(4); // restored in one transaction
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.simplify(store);
    expect(store.canUndo).toBe(before);
  });
});
