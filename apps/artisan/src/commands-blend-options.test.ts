// ─────────────────────────────────────────────────────────────
// commands-blend-options.test — Object ▸ Blend ▸ Blend Options (command)
// ─────────────────────────────────────────────────────────────
// commands.blendOptions re-spaces the selected blend in one undoable step
// (Smooth Color or Specified Steps), and is a guarded no-op (no undo, no dirty)
// without a blend selected.

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
const childCount = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as GroupItem).children.length;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makePath(squareAt(0), { fill: solid(RED) });
  const b = makePath(squareAt(100), { fill: solid(BLUE) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  commands.blend(store, { steps: 8 }); // makes the blend (10 children) + selects the group
  return { store, gid: store.getState().selection[0] };
};

describe("commands.blendOptions", () => {
  it("re-spaces to a specified step count in one undoable step", () => {
    const { store, gid } = setup();
    expect(childCount(store, gid)).toBe(10); // 2 keys + 8 steps
    commands.blendOptions(store, { mode: "steps", steps: 16 });
    expect(childCount(store, gid)).toBe(18); // 2 + 16
    store.undo();
    expect(childCount(store, gid)).toBe(10);
  });

  it("re-spaces with Smooth Color (auto step count from colour distance)", () => {
    const { store, gid } = setup();
    commands.blendOptions(store, { mode: "smooth" });
    expect(childCount(store, gid)).toBe(222); // RED↔BLUE max channel diff 220 ⇒ 220 steps
  });

  it("is a no-op (no undo entry, no dirty) when the selection has no blend", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p = makePath(squareAt(0), { fill: solid(RED) });
    doc.layers[0].items.push(p);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p.id]); // a plain path, not a blend
    const before = store.canUndo;
    commands.blendOptions(store, { mode: "steps", steps: 5 });
    expect(store.canUndo).toBe(before);
    expect(store.getState().dirty).toBe(false);
  });
});
