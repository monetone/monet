// ─────────────────────────────────────────────────────────────
// commands-reverse-path.test — Reverse Path Direction command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Path ▸ Reverse Path Direction reverses the selection in
// one undoable transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import type { PathItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath(
    { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const first = (store: ArtisanStore, id: string) => {
  const it = Query.getItem(store.getState().doc, id) as PathItem;
  return [it.geometry.anchors[0].point.x, it.geometry.anchors[0].point.y];
};

describe("commands.reversePath", () => {
  it("reverses the selected path, undoable", () => {
    const { store, p } = setup();
    expect(first(store, p.id)).toEqual([0, 0]);
    commands.reversePath(store);
    expect(first(store, p.id)).toEqual([100, 100]); // now starts at the old end

    store.undo();
    expect(first(store, p.id)).toEqual([0, 0]); // restored in one transaction
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.reversePath(store);
    expect(store.canUndo).toBe(before);
  });
});
