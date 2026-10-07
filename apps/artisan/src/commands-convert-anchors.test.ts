// ─────────────────────────────────────────────────────────────
// commands-convert-anchors.test — Convert Anchor Points to Corner / Smooth
// ─────────────────────────────────────────────────────────────
// commands.convertAnchorPoints batch-converts the Direct-Selection anchor set in
// one undoable step, and creates no undo entry when nothing would change.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";
import type { PathItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({
    closed: true,
    anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 120, y: 0 }), anchor({ x: 120, y: 120 }), anchor({ x: 0, y: 120 })],
  });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  store.setAnchorSelection({ [p.id]: [0, 1, 2, 3] });
  return { store, p };
};
const anchorsOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors;
const smoothCount = (store: ArtisanStore, id: string) =>
  anchorsOf(store, id).filter((a) => a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y).length;

describe("commands.convertAnchorPoints", () => {
  it("smooths every selected anchor in one undoable step, keeping the selection", () => {
    const { store, p } = setup();
    commands.convertAnchorPoints(store, "smooth");
    expect(smoothCount(store, p.id)).toBe(4);
    expect(store.getState().anchorSelection[p.id]).toEqual([0, 1, 2, 3]); // kept (unlike Remove, which clears)
    store.undo();
    expect(smoothCount(store, p.id)).toBe(0); // all corners again
  });

  it("corners selected anchors that were smoothed", () => {
    const { store, p } = setup();
    commands.convertAnchorPoints(store, "smooth");
    commands.convertAnchorPoints(store, "corner");
    expect(smoothCount(store, p.id)).toBe(0);
  });

  it("makes no undo entry or dirty flag when nothing would change (already the target kind)", () => {
    const { store } = setup(); // all anchors are corners; doc starts clean (markClean)
    const before = store.canUndo;
    commands.convertAnchorPoints(store, "corner"); // no-op
    expect(store.canUndo).toBe(before);
    expect(store.getState().dirty).toBe(false); // the guard prevents a spurious dirty flag
  });

  it("makes no undo entry with an empty anchor selection", () => {
    const { store } = setup();
    store.setAnchorSelection({});
    const before = store.canUndo;
    commands.convertAnchorPoints(store, "smooth");
    expect(store.canUndo).toBe(before);
  });

  it("smooth no-op on a degenerate anchor (zero tangent) leaves the doc clean", () => {
    // An open path with two coincident points: anchor 0 lacks handles but its
    // (clamped-self) prev equals its next ⇒ smoothAnchor cannot act. The guard must
    // see this and skip the transaction entirely — no undo entry, no dirty flag.
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 5, y: 5 }), anchor({ x: 5, y: 5 })] });
    doc.layers[0].items.push(p);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p.id]);
    store.setAnchorSelection({ [p.id]: [0] });
    commands.convertAnchorPoints(store, "smooth");
    expect(store.canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });
});
