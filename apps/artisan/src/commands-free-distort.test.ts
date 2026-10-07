// ─────────────────────────────────────────────────────────────
// commands-free-distort.test — Free Distort command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Effect ▸ Distort & Transform ▸ Free Distort remaps the selection
// onto a quadrilateral in one undoable transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import type { PathItem } from "./engine";
import type { FreeDistortCorners } from "./engine/ops/free-distort";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  // bbox [0,0]→[100,100]
  const p = makePath(
    { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const corner = (store: ArtisanStore, id: string, i: number) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors[i].point;

describe("commands.freeDistort", () => {
  it("applies the default perspective trapezoid (top edge in 20% each side), undoable", () => {
    const { store, p } = setup();
    commands.freeDistort(store);
    expect(corner(store, p.id, 0)).toEqual({ x: 20, y: 0 }); // TL pulled in
    expect(corner(store, p.id, 1)).toEqual({ x: 80, y: 0 }); // TR pulled in
    expect(corner(store, p.id, 2)).toEqual({ x: 100, y: 100 }); // BR pinned
    expect(corner(store, p.id, 3)).toEqual({ x: 0, y: 100 }); // BL pinned

    store.undo();
    expect(corner(store, p.id, 0)).toEqual({ x: 0, y: 0 }); // restored
  });

  it("accepts an explicit quad", () => {
    const { store, p } = setup();
    // squash the bottom edge inward 25% each side
    const quad: FreeDistortCorners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomRight: { x: 0.75, y: 1 },
      bottomLeft: { x: 0.25, y: 1 },
    };
    commands.freeDistort(store, quad);
    expect(corner(store, p.id, 2)).toEqual({ x: 75, y: 100 }); // BR pulled in
    expect(corner(store, p.id, 3)).toEqual({ x: 25, y: 100 }); // BL pulled in
    expect(corner(store, p.id, 0)).toEqual({ x: 0, y: 0 }); // TL pinned
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.freeDistort(store);
    expect(store.canUndo).toBe(before);
  });
});
