// ─────────────────────────────────────────────────────────────
// commands-blend-reverse.test — Object ▸ Blend ▸ Reverse Front to Back (command)
// ─────────────────────────────────────────────────────────────
// commands.reverseBlendFrontToBack flips the blend's paint order in one undoable
// step, and is a guarded no-op (no undo, no dirty) without a blend selected.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import type { GroupItem } from "./engine";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const squareAt = (x: number, s = 20) => ({
  closed: true,
  anchors: [anchor({ x, y: 0 }), anchor({ x: x + s, y: 0 }), anchor({ x: x + s, y: s }), anchor({ x, y: s })],
});
const childIds = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as GroupItem).children.map((c) => c.id);

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makePath(squareAt(0), { fill: solid(RED) });
  const b = makePath(squareAt(100), { fill: solid(BLUE) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  commands.blend(store, { steps: 2 }); // makes the blend + selects the group
  return { store, gid: store.getState().selection[0] };
};

describe("commands.reverseBlendFrontToBack", () => {
  it("reverses the blend's child order in one undoable step", () => {
    const { store, gid } = setup();
    const before = childIds(store, gid);
    commands.reverseBlendFrontToBack(store);
    expect(childIds(store, gid)).toEqual([...before].reverse());
    store.undo();
    expect(childIds(store, gid)).toEqual(before);
  });

  it("is a no-op (no undo entry, no dirty) when the selection has no blend", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p = makePath(squareAt(0), { fill: solid(RED) });
    doc.layers[0].items.push(p);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p.id]); // a plain path, not a blend
    const before = store.canUndo;
    commands.reverseBlendFrontToBack(store);
    expect(store.canUndo).toBe(before);
    expect(store.getState().dirty).toBe(false);
  });
});
