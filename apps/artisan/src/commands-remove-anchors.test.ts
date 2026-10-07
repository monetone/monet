// ─────────────────────────────────────────────────────────────
// commands-remove-anchors.test — Object ▸ Path ▸ Remove Anchor Points
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's Remove Anchor Points (and the Pen minus tool) deletes
// the Direct-Selection-selected anchor points while keeping each path connected.
// Mirrors the ⌫-on-selected-anchors behaviour as one undoable menu command.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";
import type { PathItem } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };
const findById = (entries: Entry[], id: string): Entry | null => {
  for (const e of entries) {
    if (e.id === id) return e;
    if (e.items) {
      const f = findById(e.items as Entry[], id);
      if (f) return f;
    }
  }
  return null;
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

const A = (x: number, y: number) => anchor({ x, y });
const geomOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry;
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  // a 5-anchor open zig-zag
  const p = makePath({ closed: false, anchors: [A(100, 300), A(150, 250), A(200, 300), A(250, 250), A(300, 300)] });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]); // setSelection clears anchorSelection, so set anchors AFTER
  return { store, p };
};

describe("commands.removeAnchorPoints", () => {
  it("deletes the selected anchor, keeps the path connected, undoably, and clears the anchor selection", () => {
    const { store, p } = setup();
    store.setAnchorSelection({ [p.id]: [2] }); // the middle anchor (200,300)
    commands.removeAnchorPoints(store);
    const g = geomOf(store, p.id);
    expect(g.anchors.length).toBe(4);
    expect(g.anchors.map((a) => a.point.x)).toEqual([100, 150, 250, 300]); // index 2 gone, neighbours bridged
    expect(g.closed).toBe(false); // an open path stays open
    expect(store.getState().anchorSelection).toEqual({}); // stale indices cleared

    store.undo();
    expect(geomOf(store, p.id).anchors.length).toBe(5); // restored
  });

  it("deletes multiple selected anchors at once", () => {
    const { store, p } = setup();
    store.setAnchorSelection({ [p.id]: [1, 3] }); // two anchors
    commands.removeAnchorPoints(store);
    expect(geomOf(store, p.id).anchors.map((a) => a.point.x)).toEqual([100, 200, 300]);
  });

  it("keeps a CLOSED path closed when ≥2 anchors remain", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [A(0, 0), A(100, 0), A(100, 100), A(0, 100)] });
    doc.layers[0].items.push(p);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p.id]);
    store.setAnchorSelection({ [p.id]: [1] });
    commands.removeAnchorPoints(store);
    const g = geomOf(store, p.id);
    expect(g.anchors.length).toBe(3);
    expect(g.closed).toBe(true); // still a closed loop
  });

  it("edits multiple paths in one undoable step", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p1 = makePath({ closed: false, anchors: [A(0, 0), A(50, 50), A(100, 0)] });
    const p2 = makePath({ closed: false, anchors: [A(0, 200), A(50, 250), A(100, 200)] });
    doc.layers[0].items.push(p1, p2);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p1.id, p2.id]);
    store.setAnchorSelection({ [p1.id]: [1], [p2.id]: [0] });
    commands.removeAnchorPoints(store);
    expect(geomOf(store, p1.id).anchors.map((a) => a.point.x)).toEqual([0, 100]); // index 1 removed
    expect(geomOf(store, p2.id).anchors.map((a) => a.point.x)).toEqual([50, 100]); // index 0 removed
    store.undo(); // a single undo restores BOTH
    expect(geomOf(store, p1.id).anchors.length).toBe(3);
    expect(geomOf(store, p2.id).anchors.length).toBe(3);
  });

  it("removes the whole path when it would be left with fewer than 2 anchors", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [A(0, 0), A(100, 0)] });
    doc.layers[0].items.push(p);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p.id]);
    store.setAnchorSelection({ [p.id]: [0] }); // would leave 1 anchor
    commands.removeAnchorPoints(store);
    expect(Query.getItem(store.getState().doc, p.id)).toBeNull(); // path dropped
  });

  it("is a no-op when no anchors are selected (no undo entry)", () => {
    const { store } = setup();
    store.setAnchorSelection({}); // no anchor selection
    const before = store.canUndo;
    commands.removeAnchorPoints(store);
    expect(store.canUndo).toBe(before);
  });
});

describe("menus — Object ▸ Path ▸ Remove Anchor Points", () => {
  it("is gated on an anchor selection and runs when one exists", () => {
    const { store, p } = setup();
    expect(itemById(store, "remove-anchors")!.disabled).toBe(true); // no anchors selected yet

    store.setAnchorSelection({ [p.id]: [2] });
    expect(itemById(store, "remove-anchors")!.disabled).toBeFalsy();
    itemById(store, "remove-anchors")!.action!();
    expect(geomOf(store, p.id).anchors.length).toBe(4);
  });
});
