// ─────────────────────────────────────────────────────────────
// commands-add-used-colors.test — Swatches ▸ Add Used Colors (command path)
// ─────────────────────────────────────────────────────────────
// The Swatches panel "Add Used Colors" button calls commands.addUsedColors: it
// appends every solid colour the artwork uses that isn't already a swatch, in
// one undoable step, cloning the paints, and is a no-op when none are missing.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
import type { Paint } from "./engine";

const swatches = (s: ArtisanStore) => s.getState().doc.swatches;
const hasColor = (ps: Paint[], r: number, g: number, b: number) =>
  ps.some((p) => p.type === "solid" && p.color.r === r && p.color.g === g && p.color.b === b);

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.swatches = []; // clean library for exact assertions
  const a = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(123, 45, 67, 1)) });
  a.stroke = { ...a.stroke, paint: { type: "none" } };
  const b = makeRect(20, 0, 10, 10, 0, 0, { fill: solid(rgba(9, 8, 7, 1)) });
  b.stroke = { ...b.stroke, paint: { type: "none" } };
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  return store;
};

describe("commands.addUsedColors", () => {
  it("adds the artwork's used solid colours as swatches, undoably", () => {
    const store = setup();
    expect(swatches(store)).toHaveLength(0);
    commands.addUsedColors(store);
    expect(swatches(store)).toHaveLength(2);
    expect(hasColor(swatches(store), 123, 45, 67)).toBe(true);
    expect(hasColor(swatches(store), 9, 8, 7)).toBe(true);

    store.undo();
    expect(swatches(store)).toHaveLength(0); // restored
  });

  it("is idempotent — a second run adds nothing and creates no undo step", () => {
    const store = setup();
    commands.addUsedColors(store);
    expect(swatches(store)).toHaveLength(2);
    const undoDepthCanary = store.canUndo;
    commands.addUsedColors(store); // every used colour is now a swatch → no-op
    expect(swatches(store)).toHaveLength(2);
    expect(store.canUndo).toBe(undoDepthCanary);
    // a single undo removes the whole add (one transaction)
    store.undo();
    expect(swatches(store)).toHaveLength(0);
  });

  it("stores CLONES — each swatch is a distinct object from the artwork's paint", () => {
    const store = setup();
    commands.addUsedColors(store);
    const fill = store.getState().doc.layers[0].items[0].fill;
    const sw = swatches(store).find((p) => p.type === "solid" && p.color.r === 123)!;
    expect(sw).not.toBe(fill); // a clone, not the same reference (no aliasing)
    expect(sw).toEqual(fill); // …but equal by value
  });

  it("is a safe no-op (no undo step) when there is no artwork", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.swatches = [];
    store.replaceDoc(doc, { markClean: true });
    commands.addUsedColors(store);
    expect(swatches(store)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });
});
