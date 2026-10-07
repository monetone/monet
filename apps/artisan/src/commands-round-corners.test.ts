// ─────────────────────────────────────────────────────────────
// commands-round-corners.test — Round Corners command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Path ▸ Round Corners rounds the selection's corners in
// one undoable transaction (live shapes bake to a rounded path).

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!;

describe("commands.roundCorners", () => {
  it("rounds the selected shape's corners, undoable", () => {
    const { store, r } = setup();
    commands.roundCorners(store, 10);

    const it = itemOf(store, r.id);
    expect(it.type).toBe("path"); // rect baked to a rounded path
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(8);

    store.undo();
    expect(itemOf(store, r.id).type).toBe("rect"); // restored in one transaction
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.roundCorners(store, 10);
    expect(store.canUndo).toBe(before);
  });
});
