// ─────────────────────────────────────────────────────────────
// commands-artboard-duplicate.test — Object ▸ Artboards ▸ Duplicate Artboard
// ─────────────────────────────────────────────────────────────
// Duplicate Artboard copies the active artboard + the artwork fully on it to a new
// artboard 20 units to the right, offsetting the clones to land on it.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const RED = solid(rgba(220, 0, 0));
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument(); // 1 artboard at (0,0,1000,1000)
  const inA = makeRect(100, 100, 80, 60, 0, 0, { fill: RED }); // on the artboard
  const inB = makeRect(300, 300, 80, 60, 0, 0, { fill: RED }); // on the artboard
  const out = makeRect(2000, 2000, 50, 50, 0, 0, { fill: RED }); // off the artboard
  doc.layers[0].items.push(inA, inB, out);
  store.replaceDoc(doc, { markClean: true });
  return { store, inA, inB, out };
};
const boards = (s: ArtisanStore) => s.getState().doc.artboards;
const items = (s: ArtisanStore) => s.getState().doc.layers[0].items;

describe("commands.duplicateArtboard", () => {
  it("adds an offset artboard and clones only the contained artwork onto it", () => {
    const { store } = setup();
    commands.duplicateArtboard(store);
    // a second artboard, 20 to the right, same size, now active
    expect(boards(store).length).toBe(2);
    expect(boards(store)[1]).toMatchObject({ x: 1020, y: 0, width: 1000, height: 1000 });
    expect(store.getState().doc.activeArtboard).toBe(1);
    // 3 originals + 2 clones (the off-board rect is NOT duplicated)
    expect(items(store).length).toBe(5);
    // the clones are selected and offset by dx = 1020 onto the new artboard
    const sel = store.getState().selection;
    expect(sel.length).toBe(2);
    const cloneXs = sel.map((id) => Query.worldBounds(store.getState().doc, id)!.x).sort((a, b) => a - b);
    expect(cloneXs).toEqual([1120, 1320]); // 100+1020 and 300+1020
  });

  it("still creates the duplicate artboard when no artwork is on it", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true }); // empty artboard
    commands.duplicateArtboard(store);
    expect(boards(store).length).toBe(2);
    expect(store.getState().selection).toEqual([]); // nothing to clone
  });

  it("is undoable (artboards, items, and selection restored)", () => {
    const { store } = setup();
    commands.duplicateArtboard(store);
    store.undo();
    expect(boards(store).length).toBe(1);
    expect(items(store).length).toBe(3);
    expect(store.getState().selection).toEqual([]);
  });
});
