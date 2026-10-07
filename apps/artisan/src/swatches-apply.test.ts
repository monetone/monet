// ─────────────────────────────────────────────────────────────
// swatches-apply.test — Swatches/Color panel apply-to-active (parity)
// ─────────────────────────────────────────────────────────────
// Integration: applyPaintToActive is what the Swatches and Color panels call when
// a swatch/colour is clicked. With Fill active it fills the selection (and updates
// the default fill); with Stroke active it sets the stroke; with no selection it
// only updates the default. Reference: Adobe Illustrator Swatches panel.

import { describe, it, expect } from "vitest";
import { applyPaintToActive } from "./ui/paint-apply";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const GREEN = rgba(0, 200, 0);
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const fillOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!.fill;
const strokePaintOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!.stroke.paint;

describe("Swatches — applyPaintToActive", () => {
  it("Fill active: fills the selection, updates the default fill, undoable", () => {
    const { store, r } = setup();
    store.setActivePaint("fill");
    applyPaintToActive(store, solid(BLUE));
    expect(fillOf(store, r.id)).toEqual(solid(BLUE));
    expect(store.getState().fill).toEqual(solid(BLUE)); // default for new objects
    store.undo();
    expect(fillOf(store, r.id)).toEqual(solid(RED));
  });

  it("Stroke active: sets the selection's stroke paint, leaves the fill", () => {
    const { store, r } = setup();
    store.setActivePaint("stroke");
    applyPaintToActive(store, solid(GREEN));
    expect(strokePaintOf(store, r.id)).toEqual(solid(GREEN));
    expect(fillOf(store, r.id)).toEqual(solid(RED)); // fill untouched
  });

  it("no selection: only updates the default fill (no transaction)", () => {
    const { store } = setup();
    store.clearSelection();
    store.setActivePaint("fill");
    const before = store.canUndo;
    applyPaintToActive(store, solid(BLUE));
    expect(store.getState().fill).toEqual(solid(BLUE));
    expect(store.canUndo).toBe(before); // nothing transacted
  });
});
