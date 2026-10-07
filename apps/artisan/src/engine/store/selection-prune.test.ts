// ─────────────────────────────────────────────────────────────
// store/selection-prune.test — a committed edit never leaves phantoms selected
// ─────────────────────────────────────────────────────────────
// undo(), redo() and cancelTransaction() already drop selection entries whose
// items are gone. Commits did not, so any op that REMOVES items left the
// selection (and anchorSelection, and keyObjectId) pointing at ids that no
// longer exist, and every later command then operated on phantoms.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makePath, makeRect, makeAnchor as anchor, Ops, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const squareAt = (x: number) => ({
  closed: true,
  anchors: [anchor({ x, y: 0 }), anchor({ x: x + 20, y: 0 }), anchor({ x: x + 20, y: 20 }), anchor({ x, y: 20 })],
});

const storeWith = (...items: ReturnType<typeof makeRect>[]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  for (const it of items) doc.layers[0].items.push(it);
  store.replaceDoc(doc, { markClean: true });
  return store;
};

describe("committing an edit prunes what it removed", () => {
  it("a transaction that deletes the selected item clears the selection", () => {
    const r = makeRect(0, 0, 20, 20, 0, 0, { fill: solid(RED) });
    const store = storeWith(r);
    store.setSelection([r.id]);
    store.setKeyObject(r.id);

    store.transact("Delete", (d) => Ops.Items.removeItems(d, [r.id]));

    expect(store.getState().selection).toEqual([]);
    expect(store.getState().keyObjectId).toBeNull();
  });

  it("removing a path's last anchors drops it from the anchor selection too", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] }, { fill: solid(RED) });
    doc.layers[0].items.push(p);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p.id]);
    store.setAnchorSelection({ [p.id]: [0] });

    // Deleting down to <2 anchors removes the path entirely.
    store.transact("Remove Anchor Points", (d) => Ops.PathEdit.deleteAnchors(d, p.id, [0]));

    expect(store.getState().selection).toEqual([]);
    expect(store.getState().anchorSelection).toEqual({});
  });

  it("keeps a selection whose items survive, and keeps its identity stable", () => {
    const a = makeRect(0, 0, 20, 20, 0, 0, { fill: solid(RED) });
    const b = makeRect(50, 0, 20, 20, 0, 0, { fill: solid(RED) });
    const store = storeWith(a, b);
    store.setSelection([a.id, b.id]);
    const before = store.getState().selection;

    store.transact("Move", (d) => Ops.Transform.translateItems(d, [a.id], 5, 5));

    expect(store.getState().selection).toBe(before); // same array identity — no churn
  });

  it("a pathfinder op that collapses to nothing leaves no phantom selected", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(500), { fill: solid(RED) }); // disjoint
    doc.layers[0].items.push(a, b);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([a.id, b.id]);

    store.transact("Pathfinder intersect", (d) => {
      Ops.Pathfinder.pathfinder(d, [a.id, b.id], "intersect");
    });

    const live = new Set(store.getState().doc.layers.flatMap((l) => l.items).map((i) => i.id));
    for (const id of store.getState().selection) {
      expect(live.has(id), `selection must not hold the removed ${id}`).toBe(true);
    }
  });
});
