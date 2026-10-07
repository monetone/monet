// ─────────────────────────────────────────────────────────────
// commands-edit-colors.test — Edit Colors command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Edit ▸ Edit Colors recolours the selection in one undoable
// transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(100, 150, 200)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const fill = (store: ArtisanStore, id: string) => {
  const f = Query.getItem(store.getState().doc, id)!.fill;
  return f.type === "solid" ? f.color : null;
};

describe("commands.editColors", () => {
  it("inverts the selection's colours, undoable", () => {
    const { store, r } = setup();
    commands.editColors(store, "invert");
    expect(fill(store, r.id)).toEqual({ r: 155, g: 105, b: 55, a: 1 });

    store.undo();
    expect(fill(store, r.id)).toEqual({ r: 100, g: 150, b: 200, a: 1 }); // restored
  });

  it("converts the selection to grayscale", () => {
    const { store, r } = setup();
    commands.editColors(store, "grayscale");
    expect(fill(store, r.id)).toEqual({ r: 141, g: 141, b: 141, a: 1 });
  });

  it("saturates and desaturates the selection", () => {
    const a = setup();
    commands.editColors(a.store, "saturate");
    expect(fill(a.store, a.r.id)).toEqual({ r: 80, g: 155, b: 230, a: 1 });

    const b = setup();
    commands.editColors(b.store, "desaturate");
    expect(fill(b.store, b.r.id)).toEqual({ r: 120, g: 145, b: 170, a: 1 });
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.editColors(store, "invert");
    expect(store.canUndo).toBe(before);
  });
});
