// ─────────────────────────────────────────────────────────────
// commands-trim-marks.test — Create Trim Marks command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Create Trim Marks adds a Trim Marks group in one
// undoable transaction, keeps the artwork, and selects the new group.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(100, 100, 200, 150, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

describe("commands.createTrimMarks", () => {
  it("adds a Trim Marks group, keeps the artwork, selects the marks, undoable", () => {
    const { store, r } = setup();
    commands.createTrimMarks(store);

    expect(items(store)).toHaveLength(2); // rect + marks
    expect(Query.getItem(store.getState().doc, r.id)).toBeTruthy(); // artwork kept
    const sel = store.getState().selection;
    expect(sel).toHaveLength(1);
    const g = Query.getItem(store.getState().doc, sel[0])!;
    expect(g.type).toBe("group");
    if (g.type === "group") {
      expect(g.name).toBe("Trim Marks");
      expect(g.children).toHaveLength(8);
    }

    store.undo();
    expect(items(store)).toHaveLength(1); // one undoable transaction
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.createTrimMarks(store);
    expect(store.canUndo).toBe(before);
    expect(items(store)).toHaveLength(1);
  });
});
