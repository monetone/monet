// ─────────────────────────────────────────────────────────────
// panels-transform.test — Properties/Transform panel X/Y/W/H fields
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Transform panel — X/Y set the selection's
// top-LEFT position (the reference point), W/H set its size anchored at that
// top-left corner. Each commit is one undoable step. (Mirrors the panel's
// setX/setY/setW/setH handlers against a real store.)

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeRect, Query, Ops, solid, rgba } from "./engine";

const bounds = (store: ArtisanStore) => Query.selectionBounds(store.getState().doc, store.getState().selection)!;
const sel = (store: ArtisanStore) => store.getState().selection;

// the panel's four handlers, verbatim
const setX = (store: ArtisanStore, v: number) => { const b = bounds(store); store.transact("Move", (d) => Ops.Transform.translateItems(d, sel(store), v - b.x, 0)); };
const setY = (store: ArtisanStore, v: number) => { const b = bounds(store); store.transact("Move", (d) => Ops.Transform.translateItems(d, sel(store), 0, v - b.y)); };
const setW = (store: ArtisanStore, v: number) => { const b = bounds(store); store.transact("Resize", (d) => Ops.Transform.scaleItems(d, sel(store), v / b.width, 1, { x: b.x, y: b.y })); };
const setH = (store: ArtisanStore, v: number) => { const b = bounds(store); store.transact("Resize", (d) => Ops.Transform.scaleItems(d, sel(store), 1, v / b.height, { x: b.x, y: b.y })); };

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(100, 100, 80, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) }); // bounds (100,100,80,60)
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store };
};

const expectBounds = (store: ArtisanStore, x: number, y: number, w: number, h: number) => {
  const b = bounds(store);
  expect(b.x).toBeCloseTo(x, 4);
  expect(b.y).toBeCloseTo(y, 4);
  expect(b.width).toBeCloseTo(w, 4);
  expect(b.height).toBeCloseTo(h, 4);
};

describe("Transform panel X/Y/W/H", () => {
  it("X moves the LEFT edge (size + Y unchanged)", () => {
    const { store } = setup();
    setX(store, 200);
    expectBounds(store, 200, 100, 80, 60);
  });

  it("Y moves the TOP edge (size + X unchanged)", () => {
    const { store } = setup();
    setY(store, 150);
    expectBounds(store, 100, 150, 80, 60);
  });

  it("W resizes the width anchored at the LEFT edge (X unchanged)", () => {
    const { store } = setup();
    setW(store, 160);
    expectBounds(store, 100, 100, 160, 60);
  });

  it("H resizes the height anchored at the TOP edge (Y unchanged)", () => {
    const { store } = setup();
    setH(store, 120);
    expectBounds(store, 100, 100, 80, 120);
  });

  it("fields compose, and each commit is one undoable step", () => {
    const { store } = setup();
    setX(store, 200);
    setW(store, 160); // anchored at the new left edge (200)
    expectBounds(store, 200, 100, 160, 60);
    store.undo(); // undo the resize only
    expectBounds(store, 200, 100, 80, 60);
    store.undo(); // undo the move
    expectBounds(store, 100, 100, 80, 60);
  });
});
