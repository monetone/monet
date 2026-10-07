// ─────────────────────────────────────────────────────────────
// commands-artboard-crud.test — Object ▸ Artboards ▸ New / Delete Artboard
// ─────────────────────────────────────────────────────────────
// newArtboard adds an artboard sized like the active one, placed to its right and
// activated; deleteArtboard removes the active one (never the last). Both undoable.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true }); // 1 artboard "Artboard 1" at (0,0,1000,1000)
  return store;
};
const boards = (s: ArtisanStore) => s.getState().doc.artboards;
const active = (s: ArtisanStore) => s.getState().doc.activeArtboard;

describe("commands.newArtboard", () => {
  it("adds an artboard sized like the active one, to its right, and activates it", () => {
    const store = setup();
    const a0 = boards(store)[0];
    const prevRight = a0.x + a0.width;
    commands.newArtboard(store);
    expect(boards(store).length).toBe(2);
    const nb = boards(store)[1];
    expect(nb.width).toBe(a0.width);
    expect(nb.height).toBe(a0.height);
    expect(nb.x).toBe(prevRight + 20); // 20-unit gap to the right
    expect(nb.y).toBe(a0.y);
    expect(active(store)).toBe(1); // the new artboard is active
  });

  it("is undoable", () => {
    const store = setup();
    commands.newArtboard(store);
    store.undo();
    expect(boards(store).length).toBe(1);
    expect(active(store)).toBe(0);
  });
});

describe("commands.deleteArtboard", () => {
  it("removes the active artboard and re-points active at a valid index", () => {
    const store = setup();
    commands.newArtboard(store); // 2 boards, active 1
    commands.newArtboard(store); // 3 boards, active 2
    expect(boards(store).length).toBe(3);
    commands.deleteArtboard(store); // remove index 2 → active = min(2, 1) = 1
    expect(boards(store).length).toBe(2);
    expect(active(store)).toBe(1);
    store.undo();
    expect(boards(store).length).toBe(3);
    expect(active(store)).toBe(2);
  });

  it("is a no-op (no undo entry) on the last remaining artboard", () => {
    const store = setup();
    const before = store.canUndo;
    commands.deleteArtboard(store);
    expect(boards(store).length).toBe(1);
    expect(store.canUndo).toBe(before);
  });
});
