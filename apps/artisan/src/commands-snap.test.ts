// ─────────────────────────────────────────────────────────────
// commands-snap.test — View ▸ Snap / Snap to Grid (parity)
// ─────────────────────────────────────────────────────────────
// Integration: the View-menu snap toggles flip store state, and snapPoint (which
// the canvas applies to every pointer) honours them — so enabling "Snap to Grid"
// makes the pointer land on grid intersections, à la Illustrator.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
import { snapPoint } from "./tools/snap";

describe("commands — Snap to Grid toggles", () => {
  it("toggleSnapGrid flips snap.toGrid and starts snapping the pointer", () => {
    const store = new ArtisanStore();
    expect(store.getState().snap.toGrid).toBe(false);
    expect(snapPoint(store.getState(), { x: 137, y: 162 })).toEqual({ x: 137, y: 162 }); // off → unchanged

    commands.toggleSnapGrid(store);
    expect(store.getState().snap.toGrid).toBe(true);
    expect(snapPoint(store.getState(), { x: 137, y: 162 })).toEqual({ x: 150, y: 150 }); // on → snapped (grid 50)
  });

  it("the master Snap toggle gates grid snapping", () => {
    const store = new ArtisanStore();
    commands.toggleSnapGrid(store); // toGrid on
    expect(snapPoint(store.getState(), { x: 137, y: 162 })).toEqual({ x: 150, y: 150 });
    commands.toggleSnap(store); // master off
    expect(store.getState().snap.enabled).toBe(false);
    expect(snapPoint(store.getState(), { x: 137, y: 162 })).toEqual({ x: 137, y: 162 }); // gated → unchanged
  });
});

describe("commands — Smart Guides (View ▸ Smart Guides ⌘U)", () => {
  it("toggleSmartGuides flips snap.toPoint and gates anchor snapping", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(200, 0, 0)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.patchSnap({ toGrid: false }); // isolate point snapping

    // default Smart Guides on → snaps near a corner (anchor takes priority)
    expect(store.getState().snap.toPoint).toBe(true);
    expect(snapPoint(store.getState(), { x: 3, y: 4 })).toEqual({ x: 0, y: 0 });

    commands.toggleSmartGuides(store); // → off (disables BOTH anchor & edge snapping)
    expect(store.getState().snap.toPoint).toBe(false);
    expect(store.getState().snap.toObject).toBe(false);
    expect(snapPoint(store.getState(), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(snapPoint(store.getState(), { x: 3, y: 50 })).toEqual({ x: 3, y: 50 }); // no edge snap either
  });
});
