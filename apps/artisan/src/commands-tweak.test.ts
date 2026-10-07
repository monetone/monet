// ─────────────────────────────────────────────────────────────
// commands-tweak.test — Tweak command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Effect ▸ Distort & Transform ▸ Tweak nudges the selection in one
// undoable transaction without adding points.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import type { PathItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath(
    { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const first = (store: ArtisanStore, id: string) => {
  const g = (Query.getItem(store.getState().doc, id) as PathItem).geometry;
  return { count: g.anchors.length, p0: g.anchors[0].point };
};

describe("commands.tweak", () => {
  it("nudges the selection's anchors (no points added), undoable", () => {
    const { store, p } = setup();
    expect(first(store, p.id)).toEqual({ count: 4, p0: { x: 0, y: 0 } });
    commands.tweak(store);
    const after = first(store, p.id);
    expect(after.count).toBe(4); // no points added
    expect(after.p0).not.toEqual({ x: 0, y: 0 }); // moved

    store.undo();
    expect(first(store, p.id)).toEqual({ count: 4, p0: { x: 0, y: 0 } }); // restored
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.tweak(store);
    expect(store.canUndo).toBe(before);
  });
});
