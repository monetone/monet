// ─────────────────────────────────────────────────────────────
// commands-slice.test — Object ▸ Slice ▸ Create from Selection / Delete All
// ─────────────────────────────────────────────────────────────
// Integration: Create from Selection adds an export slice matching the
// selection's world bounding box; Delete All Slices clears them. Both undoable,
// both no-op when there is nothing to do.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(100, 100, 80, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const slices = (store: ArtisanStore) => store.getState().doc.slices ?? [];

describe("commands.createSliceFromSelection", () => {
  it("adds a slice matching the selection's bounds, undoably", () => {
    const { store } = setup();
    commands.createSliceFromSelection(store);
    const sl = slices(store);
    expect(sl).toHaveLength(1);
    expect({ x: sl[0].x, y: sl[0].y, w: sl[0].width, h: sl[0].height }).toEqual({ x: 100, y: 100, w: 80, h: 60 });

    store.undo();
    expect(slices(store)).toHaveLength(0);
  });

  it("appends a second slice with an incremented name", () => {
    const { store } = setup();
    commands.createSliceFromSelection(store);
    commands.createSliceFromSelection(store);
    expect(slices(store).map((s) => s.name)).toEqual(["Slice 1", "Slice 2"]);
  });

  it("no-op (no undo entry) with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.createSliceFromSelection(store);
    expect(store.canUndo).toBe(before);
    expect(slices(store)).toHaveLength(0);
  });
});

describe("commands.deleteAllSlices", () => {
  it("clears every slice, undoably", () => {
    const { store } = setup();
    commands.createSliceFromSelection(store);
    expect(slices(store)).toHaveLength(1);
    commands.deleteAllSlices(store);
    expect(slices(store)).toHaveLength(0);

    store.undo();
    expect(slices(store)).toHaveLength(1); // back
  });

  it("no-op (no undo entry) when there are no slices", () => {
    const { store } = setup();
    const before = store.canUndo;
    commands.deleteAllSlices(store);
    expect(store.canUndo).toBe(before);
  });
});

describe("commands.createSlicesFromGuides", () => {
  const build = () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.artboards = [{ id: "A1", name: "AB", x: 0, y: 0, width: 400, height: 300 }];
    store.replaceDoc(doc, { markClean: true });
    return store;
  };
  const cells = (store: ArtisanStore) => (store.getState().doc.slices ?? []).map((s) => ({ x: s.x, y: s.y, w: s.width, h: s.height }));

  it("partitions the artboard into a grid at the guides (1 vertical + 1 horizontal → 4)", () => {
    const store = build();
    store.addGuide("v", 200);
    store.addGuide("h", 150);
    commands.createSlicesFromGuides(store);
    const sl = cells(store);
    expect(sl).toHaveLength(4);
    expect(sl).toContainEqual({ x: 0, y: 0, w: 200, h: 150 });
    expect(sl).toContainEqual({ x: 200, y: 0, w: 200, h: 150 });
    expect(sl).toContainEqual({ x: 0, y: 150, w: 200, h: 150 });
    expect(sl).toContainEqual({ x: 200, y: 150, w: 200, h: 150 });
  });

  it("makes a single artboard-sized slice when there are no guides", () => {
    const store = build();
    commands.createSlicesFromGuides(store);
    expect(cells(store)).toEqual([{ x: 0, y: 0, w: 400, h: 300 }]);
  });

  it("ignores guides outside the artboard, and is undoable", () => {
    const store = build();
    store.addGuide("v", 500); // outside the 0..400 artboard → ignored
    store.addGuide("h", 150); // inside → splits into 2 rows
    commands.createSlicesFromGuides(store);
    expect(cells(store)).toHaveLength(2);
    store.undo();
    expect(cells(store)).toHaveLength(0);
  });
});
