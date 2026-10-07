// ─────────────────────────────────────────────────────────────
// commands-sort-swatches.test — Swatches panel ▸ Sort by Hue
// ─────────────────────────────────────────────────────────────
// sortPaintsByHue orders solids by hue (non-solids last, stable); the command
// reorders doc.swatches undoably and no-ops when already sorted.

import { describe, it, expect } from "vitest";
import { commands, sortPaintsByHue } from "./commands";
import { ArtisanStore, makeDocument, solid, rgba, noPaint } from "./engine";
import type { Paint } from "./engine";

const RED = solid(rgba(255, 0, 0)); // hue 0
const GREEN = solid(rgba(0, 255, 0)); // hue 120
const BLUE = solid(rgba(0, 0, 255)); // hue 240
const keys = (paints: Paint[]) =>
  paints.map((p) => (p.type === "solid" ? `${p.color.r},${p.color.g},${p.color.b}` : p.type));

describe("sortPaintsByHue", () => {
  it("orders solid paints by hue", () => {
    expect(keys(sortPaintsByHue([BLUE, RED, GREEN]))).toEqual(["255,0,0", "0,255,0", "0,0,255"]);
  });

  it("keeps non-solid paints after the solids, in their original order", () => {
    expect(keys(sortPaintsByHue([noPaint(), BLUE, RED]))).toEqual(["255,0,0", "0,0,255", "none"]);
  });

  it("is stable for two non-solid paints (preserves order)", () => {
    const n1 = noPaint();
    const n2 = noPaint();
    const sorted = sortPaintsByHue([n1, n2]);
    expect(sorted[0]).toBe(n1);
    expect(sorted[1]).toBe(n2);
  });
});

describe("commands.sortSwatchesByHue", () => {
  const setup = (swatches: Paint[]) => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.swatches = swatches.map((p) => ({ ...p }));
    store.replaceDoc(doc, { markClean: true });
    return store;
  };
  const swatchKeys = (store: ArtisanStore) => keys(store.getState().doc.swatches);

  it("reorders doc.swatches by hue, undoably", () => {
    const store = setup([BLUE, RED, GREEN]);
    commands.sortSwatchesByHue(store);
    expect(swatchKeys(store)).toEqual(["255,0,0", "0,255,0", "0,0,255"]);
    store.undo();
    expect(swatchKeys(store)).toEqual(["0,0,255", "255,0,0", "0,255,0"]); // back to original
  });

  it("is a no-op (no undo, no dirty) when already sorted", () => {
    const store = setup([RED, GREEN, BLUE]);
    const before = store.canUndo;
    commands.sortSwatchesByHue(store);
    expect(store.canUndo).toBe(before);
    expect(store.getState().dirty).toBe(false);
  });

  it("is a no-op with fewer than two swatches", () => {
    const store = setup([RED]);
    commands.sortSwatchesByHue(store);
    expect(store.canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });
});
