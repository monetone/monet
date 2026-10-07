// ─────────────────────────────────────────────────────────────
// commands-transform-copies.test — Transform (copies) command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Effect ▸ Distort & Transform ▸ Transform stamps copies in one
// undoable transaction and selects the resulting group.

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
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

describe("commands.transformCopies", () => {
  it("step-and-repeats with the default (move 20,20 × 5), undoable", () => {
    const { store } = setup();
    commands.transformCopies(store);

    expect(items(store)).toHaveLength(1); // replaced by the group
    const g = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    expect(g.type).toBe("group");
    if (g.type === "group") expect(g.children).toHaveLength(6); // original + 5 copies

    store.undo();
    expect(items(store)).toHaveLength(1);
    expect(items(store)[0].type).toBe("rect"); // restored in one transaction
  });

  it("honours an explicit copy count", () => {
    const { store } = setup();
    commands.transformCopies(store, { moveX: 10, moveY: 0, copies: 2 });
    const g = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    if (g.type !== "group") throw new Error("expected group");
    expect(g.children).toHaveLength(3);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.transformCopies(store);
    expect(store.canUndo).toBe(before);
  });
});
