// ─────────────────────────────────────────────────────────────
// commands-clean-up.test — Object ▸ Path ▸ Clean Up (parity)
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore driven through commands.cleanUp — stray points
// are removed in one undoable transaction, and the selection is pruned of any ids
// that were deleted.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, makeRect, solid, rgba } from "./engine";

describe("commands.cleanUp", () => {
  const setup = () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const stray = makePath({ closed: false, anchors: [anchor({ x: 5, y: 5 })] }, { fill: solid(rgba(220, 0, 0)) });
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    doc.layers[0].items.push(stray, rect);
    store.replaceDoc(doc, { markClean: true });
    return { store, stray, rect };
  };

  it("removes stray points, prunes the selection, and is undoable", () => {
    const { store, stray, rect } = setup();
    store.setSelection([stray.id, rect.id]);
    commands.cleanUp(store);
    expect(store.getState().doc.layers[0].items.length).toBe(1); // stray gone
    expect(store.getState().selection).toEqual([rect.id]); // deleted id pruned
    store.undo();
    expect(store.getState().doc.layers[0].items.length).toBe(2); // restored
  });

  it("is a no-op on a clean document", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.layers[0].items.push(makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 120, 220)) }));
    store.replaceDoc(doc, { markClean: true });
    const before = store.canUndo;
    commands.cleanUp(store);
    // transaction runs but the doc is unchanged → no undo entry pushed
    expect(store.getState().doc.layers[0].items.length).toBe(1);
    expect(store.canUndo).toBe(before);
  });
});
