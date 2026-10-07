// ─────────────────────────────────────────────────────────────
// panels-properties-shape.test — Properties panel live-shape edits (parity)
// ─────────────────────────────────────────────────────────────
// Integration: drive a real ArtisanStore exactly as the Properties panel does
// (store.transact → Ops.Shape.*) for the contextual shape fields, and confirm the
// edit is a single undoable transaction that regenerates the live geometry.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeRect, makePolygon, makeStar, Ops, Query, Shapes, type Item } from "./engine";

const setup = (item: Item) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.layers[0].items.push(item);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([item.id]);
  return store;
};
const get = (store: ArtisanStore, id: string) =>
  Query.getItem(store.getState().doc, id)! as Item & { rx: number; sides: number; points: number };
const anchors = (store: ArtisanStore, id: string) => Shapes.localPaths(Query.getItem(store.getState().doc, id)!)[0].anchors.length;

describe("Properties panel — live shape parameters (integration)", () => {
  it("Corner Radius edit rounds the rect and is undoable", () => {
    const r = makeRect(0, 0, 100, 60, 0, 0);
    const store = setup(r);
    store.transact("Corner Radius", (d) => Ops.Shape.setCornerRadius(d, [r.id], 15));
    expect(get(store, r.id).rx).toBe(15);
    expect(anchors(store, r.id)).toBe(8);
    store.undo();
    expect(get(store, r.id).rx).toBe(0);
    expect(anchors(store, r.id)).toBe(4); // back to a sharp rect
  });

  it("Sides edit changes the polygon and is undoable", () => {
    const p = makePolygon(100, 100, 50, 3);
    const store = setup(p);
    store.transact("Sides", (d) => Ops.Shape.setPolygonSides(d, [p.id], 7));
    expect(get(store, p.id).sides).toBe(7);
    expect(anchors(store, p.id)).toBe(7);
    store.undo();
    expect(get(store, p.id).sides).toBe(3);
  });

  it("Points edit changes the star and is undoable", () => {
    const s = makeStar(100, 100, 50, 25, 5);
    const store = setup(s);
    store.transact("Points", (d) => Ops.Shape.setStarPoints(d, [s.id], 9));
    expect(get(store, s.id).points).toBe(9);
    expect(anchors(store, s.id)).toBe(18);
    store.undo();
    expect(get(store, s.id).points).toBe(5);
  });
});
