// ─────────────────────────────────────────────────────────────
// commands-swatches.test — Swatches panel New / Delete (command path)
// ─────────────────────────────────────────────────────────────
// The Swatches panel toolbar calls commands.newSwatch / deleteSwatch: each edits
// the document's swatch library in one undoable step.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true }); // doc starts with default swatches
  return store;
};
const swatches = (store: ArtisanStore) => store.getState().doc.swatches;

describe("commands.newSwatch", () => {
  it("appends the paint to the document swatches, undoably", () => {
    const store = setup();
    const before = swatches(store).length;
    commands.newSwatch(store, solid(rgba(220, 0, 0, 1)));
    expect(swatches(store).length).toBe(before + 1);
    const last = swatches(store)[before];
    expect(last.type === "solid" ? last.color : null).toEqual(rgba(220, 0, 0, 1));

    store.undo();
    expect(swatches(store).length).toBe(before);
  });

  it("stores a CLONE — mutating the source paint afterwards does not change the swatch", () => {
    const store = setup();
    const before = swatches(store).length;
    const p = solid(rgba(10, 20, 30, 1));
    commands.newSwatch(store, p);
    if (p.type !== "solid") throw new Error("expected a solid paint");
    p.color.r = 255; // mutate the original after saving
    const sw = swatches(store)[before];
    expect(sw.type === "solid" ? sw.color.r : null).toBe(10); // unaffected
  });
});

describe("commands.deleteSwatch", () => {
  it("removes the swatch at the index, undoably", () => {
    const store = setup();
    const before = swatches(store).length;
    const second = swatches(store)[1];
    commands.deleteSwatch(store, 0);
    expect(swatches(store).length).toBe(before - 1);
    expect(swatches(store)[0]).toEqual(second); // index 1 shifted down to 0

    store.undo();
    expect(swatches(store).length).toBe(before);
  });

  it("removes exactly the swatch at a MIDDLE index, leaving the rest in order", () => {
    const store = setup();
    const before = swatches(store).slice();
    commands.deleteSwatch(store, 2); // a non-tail index
    expect(swatches(store)).toEqual([...before.slice(0, 2), ...before.slice(3)]); // only index 2 gone, order kept
  });

  it("is a no-op for an out-of-range index (no undo entry)", () => {
    const store = setup();
    const before = store.canUndo;
    const n = swatches(store).length;
    commands.deleteSwatch(store, -1);
    commands.deleteSwatch(store, n); // == length, out of range
    expect(store.canUndo).toBe(before);
    expect(swatches(store).length).toBe(n); // untouched
  });
});

describe("commands.deleteUnusedSwatches", () => {
  const RED = rgba(220, 0, 0);
  const BLUE = rgba(0, 0, 220);
  // a store whose swatches are exactly [RED, BLUE] with one rect filled `used`.
  const build = (used: ReturnType<typeof rgba>) => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.swatches = [solid(RED), solid(BLUE)];
    doc.layers[0].items.push(makeRect(0, 0, 10, 10, 0, 0, { fill: solid(used) }));
    store.replaceDoc(doc, { markClean: true });
    return store;
  };

  it("removes only the swatches no artwork uses, undoably", () => {
    const store = build(BLUE); // only BLUE is used
    commands.deleteUnusedSwatches(store);
    const sw = store.getState().doc.swatches;
    expect(sw).toHaveLength(1);
    expect(sw[0].type === "solid" ? sw[0].color : null).toEqual(BLUE); // RED dropped

    store.undo();
    expect(store.getState().doc.swatches).toHaveLength(2); // both back
  });

  it("is a no-op when every swatch is used (no undo entry)", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.swatches = [solid(RED), solid(BLUE)];
    doc.layers[0].items.push(makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }), makeRect(20, 0, 10, 10, 0, 0, { fill: solid(BLUE) }));
    store.replaceDoc(doc, { markClean: true });
    const before = store.canUndo;
    commands.deleteUnusedSwatches(store);
    expect(store.canUndo).toBe(before); // nothing removed
    expect(store.getState().doc.swatches).toHaveLength(2);
  });
});
