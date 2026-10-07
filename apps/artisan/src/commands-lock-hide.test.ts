// ─────────────────────────────────────────────────────────────
// commands-lock-hide.test — Object ▸ Lock / Hide / Unlock All / Show All (parity)
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore driven through the commands. Lock/Hide
// deselect the affected objects (you can't keep a locked/hidden object selected);
// Unlock All / Show All revert and re-select. Each is one undoable transaction.

import { describe, it, expect } from "vitest";
import { commands, hasLockedItems, hasHiddenItems } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(60, 0, 50, 50, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id]);
  return { store, a, b };
};
const item = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!;

describe("commands — Lock / Unlock All", () => {
  it("Lock Selection locks + deselects; Unlock All restores + selects", () => {
    const { store, a } = setup();
    commands.lockSelection(store);
    expect(item(store, a.id).locked).toBe(true);
    expect(store.getState().selection).toEqual([]); // deselected
    expect(hasLockedItems(store)).toBe(true);

    commands.unlockAll(store);
    expect(item(store, a.id).locked).toBe(false);
    expect(store.getState().selection).toEqual([a.id]); // the unlocked object is selected
  });

  it("Lock is a single undoable transaction", () => {
    const { store, a } = setup();
    commands.lockSelection(store);
    expect(item(store, a.id).locked).toBe(true);
    store.undo();
    expect(item(store, a.id).locked).toBe(false);
  });
});

describe("commands — Hide / Show All", () => {
  it("Hide Selection hides + deselects; Show All restores + selects", () => {
    const { store, a } = setup();
    commands.hideSelection(store);
    expect(item(store, a.id).visible).toBe(false);
    expect(store.getState().selection).toEqual([]);
    expect(hasHiddenItems(store)).toBe(true);

    commands.showAll(store);
    expect(item(store, a.id).visible).toBe(true);
    expect(store.getState().selection).toEqual([a.id]);
  });
});

describe("commands — Lock/Hide guards", () => {
  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.lockSelection(store);
    commands.hideSelection(store);
    expect(store.canUndo).toBe(before); // nothing transacted
  });
});
