// ─────────────────────────────────────────────────────────────
// commands-blend-colors.test — Blend Colors command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Edit ▸ Edit Colors ▸ Blend … blends ≥3 solid fills in one undoable
// transaction and is a no-op below 3 solid objects.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, noPaint, paintedFill, Query, solid, rgba } from "./engine";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) });
  const b = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 255, 0)) });
  const c = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(BLUE) });
  doc.layers[0].items.push(a, b, c);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id, c.id]);
  return { store, a, b, c };
};
const fill = (store: ArtisanStore, id: string) => {
  const f = Query.getItem(store.getState().doc, id)!.fill;
  return f.type === "solid" ? f.color : null;
};

describe("commands.blendColors", () => {
  it("blends front-to-back, undoable", () => {
    const { store, b } = setup();
    commands.blendColors(store, "front-to-back");
    expect(fill(store, b.id)).toEqual({ r: 110, g: 0, b: 110, a: 1 }); // mid → 50/50

    store.undo();
    expect(fill(store, b.id)).toEqual({ r: 0, g: 255, b: 0, a: 1 }); // restored
  });

  it("no-op below 3 solid objects", () => {
    const { store, a, b } = setup();
    store.setSelection([a.id, b.id]);
    const before = store.canUndo;
    commands.blendColors(store, "horizontal");
    expect(store.canUndo).toBe(before);
  });

  it("accepts solid fills supplied by appearance stacks", () => {
    const { store, a, b, c } = setup();
    for (const item of [a, b, c]) {
      item.appearance = { entries: [{ id: `${item.id}-fill`, kind: "fill", paint: item.fill }] };
      item.fill = noPaint();
    }
    store.replaceDoc(store.doc, { markClean: true });
    store.setSelection([a.id, b.id, c.id]);

    commands.blendColors(store, "front-to-back");

    expect(paintedFill(Query.getItem(store.doc, b.id)!)).toEqual(solid(rgba(110, 0, 110)));
  });
});
