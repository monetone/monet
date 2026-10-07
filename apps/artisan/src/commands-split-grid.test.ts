// ─────────────────────────────────────────────────────────────
// commands-split-grid.test — Split Into Grid command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Path ▸ Split Into Grid replaces the selection with a
// grid group in one undoable transaction, and selects the result.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

describe("commands.splitIntoGrid", () => {
  it("replaces the selection with a default 2×2 grid group, selects it, undoable", () => {
    const { store, r } = setup();
    commands.splitIntoGrid(store);

    expect(items(store)).toHaveLength(1);
    expect(Query.getItem(store.getState().doc, r.id)).toBeNull(); // original replaced
    const sel = store.getState().selection;
    expect(sel).toHaveLength(1);
    const g = Query.getItem(store.getState().doc, sel[0])!;
    expect(g.type).toBe("group");
    if (g.type === "group") expect(g.children).toHaveLength(4); // 2×2

    store.undo();
    expect(items(store)).toHaveLength(1);
    expect(items(store)[0].type).toBe("rect"); // restored in one transaction
  });

  it("honours explicit rows/columns", () => {
    const { store } = setup();
    commands.splitIntoGrid(store, { rows: 3, columns: 5 });
    const g = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    if (g.type !== "group") throw new Error("expected group");
    expect(g.children).toHaveLength(15);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.splitIntoGrid(store);
    expect(store.canUndo).toBe(before);
  });
});
