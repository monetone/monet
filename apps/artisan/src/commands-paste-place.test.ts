// ─────────────────────────────────────────────────────────────
// commands-paste-place.test — Paste in Place / Paste on All Artboards
// ─────────────────────────────────────────────────────────────
// Illustrator ⌥⌘V pastes at the same position relative to the ACTIVE artboard as
// the copy had on its source artboard; ⌥⇧⌘V drops that copy on every artboard.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeArtboard, makeRect, solid, rgba, Query } from "./engine";

// Two artboards side by side: AB1 at origin, AB2 shifted +1200 in x.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument(); // AB1 (0,0,1000,1000)
  doc.artboards.push(makeArtboard("Artboard 2", 1200, 0, 1000, 1000));
  const r = makeRect(100, 100, 80, 80, 0, 0, { fill: solid(rgba(80, 140, 220)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const xyOf = (store: ArtisanStore, ids: string[]) => {
  const b = Query.selectionBounds(store.getState().doc, ids)!;
  return [b.x, b.y];
};

describe("commands.pasteInPlace", () => {
  it("reproduces the original position when the active artboard is the source", () => {
    const { store, r } = setup();
    commands.copy(store);
    commands.pasteInPlace(store);
    const seln = store.getState().selection;
    expect(seln.length).toBe(1);
    expect(seln[0]).not.toBe(r.id); // a fresh copy
    expect(xyOf(store, seln)).toEqual([100, 100]);
  });

  it("repositions onto a different active artboard by the artboard delta", () => {
    const { store } = setup();
    commands.copy(store); // source = AB1 origin (0,0)
    store.mutate((d) => {
      d.activeArtboard = 1; // switch to AB2 (origin 1200,0)
    });
    commands.pasteInPlace(store);
    expect(xyOf(store, store.getState().selection)).toEqual([1300, 100]); // 100 + 1200
  });

  it("is undoable", () => {
    const { store } = setup();
    const before = store.getState().doc.layers[0].items.length;
    commands.copy(store);
    commands.pasteInPlace(store);
    expect(store.getState().doc.layers[0].items.length).toBe(before + 1);
    store.undo();
    expect(store.getState().doc.layers[0].items.length).toBe(before);
  });

  it("captures the SOURCE artboard by bbox centre, not the active one", () => {
    // AB1 active, but the object sits on AB2 (centre 1340,140 ∈ AB2). Pasting in
    // place onto the active AB1 must reproduce its AB2-relative x (100) ⇒ x=100,
    // proving the source origin was AB2 (1200), not the active AB1 (0).
    const store = new ArtisanStore();
    const doc = makeDocument(); // AB1 (0,0,1000,1000), active
    doc.artboards.push(makeArtboard("Artboard 2", 1200, 0, 1000, 1000));
    const r = makeRect(1300, 100, 80, 80, 0, 0, { fill: solid(rgba(80, 140, 220)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    commands.copy(store); // source = AB2 (centre containment)
    commands.pasteInPlace(store); // active = AB1
    expect(xyOf(store, store.getState().selection)).toEqual([100, 100]); // 1300 − 1200
  });

  it("carries the artboard delta on BOTH axes (catches a dy sign slip)", () => {
    const store = new ArtisanStore();
    const doc = makeDocument(); // AB1 (0,0,1000,1000)
    doc.artboards.push(makeArtboard("Artboard 2", 0, 1200, 1000, 1000)); // offset in Y
    const r = makeRect(100, 100, 80, 80, 0, 0, { fill: solid(rgba(80, 140, 220)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    commands.copy(store); // source AB1 (0,0)
    store.mutate((d) => {
      d.activeArtboard = 1; // AB2 origin (0,1200)
    });
    commands.pasteInPlace(store);
    expect(xyOf(store, store.getState().selection)).toEqual([100, 1300]); // dy = +1200
  });

  it("falls back to the ACTIVE artboard origin when the copy is off every board", () => {
    const store = new ArtisanStore();
    const doc = makeDocument(); // AB1 (0,0,1000,1000)
    doc.artboards.push(makeArtboard("Artboard 2", 1200, 0, 1000, 1000));
    const r = makeRect(500, 2000, 80, 80, 0, 0, { fill: solid(rgba(80, 140, 220)) }); // below both boards
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    store.mutate((d) => {
      d.activeArtboard = 1; // make AB2 active BEFORE copy
    });
    commands.copy(store); // no board contains the centre ⇒ origin = active AB2 (1200,0)
    commands.pasteInPlace(store); // active still AB2 ⇒ dx=dy=0
    expect(xyOf(store, store.getState().selection)).toEqual([500, 2000]); // unmoved (not shifted by boards[0])
  });

  it("is a no-op with an empty clipboard", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    store.replaceDoc(doc, { markClean: true });
    // Nothing copied in THIS test, but the module clipboard may carry prior data;
    // copy an empty selection to force the clipboard empty.
    store.clearSelection();
    commands.copy(store); // empty selection ⇒ empty clipboard
    const before = store.canUndo;
    commands.pasteInPlace(store);
    expect(store.canUndo).toBe(before);
  });
});

describe("commands.pasteOnAllArtboards", () => {
  it("drops a copy on every artboard at the same relative position", () => {
    const { store } = setup();
    commands.copy(store);
    commands.pasteOnAllArtboards(store);
    const seln = store.getState().selection;
    expect(seln.length).toBe(2);
    const xs = seln.map((id) => Query.selectionBounds(store.getState().doc, [id])!.x).sort((a, b) => a - b);
    expect(xs).toEqual([100, 1300]); // AB1 keeps 100, AB2 gets 100+1200
  });

  it("clones a fresh, distinct set per artboard (no shared identity), in one undo step", () => {
    const store = new ArtisanStore();
    const doc = makeDocument(); // AB1 (0,0,1000,1000)
    doc.artboards.push(makeArtboard("Artboard 2", 1200, 0, 1000, 1000));
    const r1 = makeRect(100, 100, 80, 80, 0, 0, { fill: solid(rgba(80, 140, 220)) });
    const r2 = makeRect(300, 100, 80, 80, 0, 0, { fill: solid(rgba(220, 90, 90)) });
    doc.layers[0].items.push(r1, r2);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r1.id, r2.id]);
    const before = store.getState().doc.layers[0].items.length; // 2
    commands.copy(store);
    commands.pasteOnAllArtboards(store);
    const seln = store.getState().selection;
    expect(seln.length).toBe(4); // two items × two boards
    expect(new Set(seln).size).toBe(4); // all distinct ids — no aliasing
    expect(seln.some((id) => id === r1.id || id === r2.id)).toBe(false); // none are the originals
    const xs = seln.map((id) => Query.selectionBounds(store.getState().doc, [id])!.x).sort((a, b) => a - b);
    expect(xs).toEqual([100, 300, 1300, 1500]); // both items on both boards, per-board delta applied
    expect(store.getState().doc.layers[0].items.length).toBe(before + 4);
    store.undo(); // a single transaction for the whole multi-board loop
    expect(store.getState().doc.layers[0].items.length).toBe(before);
  });

  it("falls back to a single Paste in Place with only one artboard", () => {
    const store = new ArtisanStore();
    const doc = makeDocument(); // single artboard
    const r = makeRect(100, 100, 80, 80, 0, 0, { fill: solid(rgba(80, 140, 220)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    commands.copy(store);
    commands.pasteOnAllArtboards(store);
    expect(store.getState().selection.length).toBe(1);
    expect(xyOf(store, store.getState().selection)).toEqual([100, 100]);
  });
});
