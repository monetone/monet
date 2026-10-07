// ─────────────────────────────────────────────────────────────
// commands-offset-path.test — Offset Path command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Path ▸ Offset Path runs in one undoable transaction,
// keeps the original, adds the offset copy, and re-selects the new path.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(100, 100, 80, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;
const boundsOf = (store: ArtisanStore, id: string) => Query.worldBounds(store.getState().doc, id)!;

describe("commands.offsetPath", () => {
  it("adds an outward offset path, keeps the original, selects the new one, undoable", () => {
    const { store, r } = setup();
    commands.offsetPath(store, { distance: 10 });

    expect(items(store)).toHaveLength(2); // original + offset
    expect(Query.getItem(store.getState().doc, r.id)).toBeTruthy(); // original kept
    const selection = store.getState().selection;
    expect(selection).toHaveLength(1);
    expect(selection[0]).not.toBe(r.id); // the NEW offset path is selected

    const b = boundsOf(store, selection[0]);
    expect([b.x, b.y, b.width, b.height]).toEqual([90, 90, 100, 80]); // grown 10 each side

    store.undo();
    expect(items(store)).toHaveLength(1); // one undoable transaction
    expect(store.getState().selection).toEqual([r.id]);
  });

  it("honours the join option (round adds anchors versus miter)", () => {
    const miterStore = setup().store;
    commands.offsetPath(miterStore, { distance: 10, join: "miter" });
    const miterSel = miterStore.getState().selection[0];
    const miterItem = Query.getItem(miterStore.getState().doc, miterSel)!;

    const roundStore = setup().store;
    commands.offsetPath(roundStore, { distance: 10, join: "round" });
    const roundSel = roundStore.getState().selection[0];
    const roundItem = Query.getItem(roundStore.getState().doc, roundSel)!;

    const count = (it: typeof miterItem) => (it.type === "path" ? it.geometry.anchors.length : 0);
    expect(count(miterItem)).toBe(4);
    expect(count(roundItem)).toBeGreaterThan(4);
  });

  it("shrinks for a negative distance", () => {
    const { store } = setup();
    commands.offsetPath(store, { distance: -10 });
    const b = boundsOf(store, store.getState().selection[0]);
    expect([b.x, b.y, b.width, b.height]).toEqual([110, 110, 60, 40]);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.offsetPath(store, { distance: 10 });
    expect(store.canUndo).toBe(before);
    expect(items(store)).toHaveLength(1);
  });
});
