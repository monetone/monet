// ─────────────────────────────────────────────────────────────
// commands-blend.test — Blend command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Blend ▸ Make runs in one undoable transaction, replaces
// the selection with a single Blend group, and needs ≥2 objects.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(200, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  return { store, a, b };
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

describe("commands.blend", () => {
  it("replaces the selection with a single Blend group, undoable", () => {
    const { store } = setup();
    commands.blend(store, { steps: 1 });

    expect(items(store)).toHaveLength(1); // two rects → one blend group
    const sel = store.getState().selection;
    expect(sel).toHaveLength(1);
    const g = Query.getItem(store.getState().doc, sel[0])!;
    expect(g.type).toBe("group");
    if (g.type === "group") {
      expect(g.name).toBe("Blend");
      expect(g.children).toHaveLength(3); // end + 1 step + end
    }

    store.undo();
    expect(items(store)).toHaveLength(2); // one undoable transaction restores both rects
  });

  it("uses the default step count when none is given", () => {
    const { store } = setup();
    commands.blend(store);
    const g = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    expect(g.type).toBe("group");
    if (g.type === "group") expect(g.children.length).toBe(10); // 2 ends + 8 default steps
  });

  it("no-op with fewer than two objects selected", () => {
    const { store, a } = setup();
    store.setSelection([a.id]);
    const before = store.canUndo;
    commands.blend(store, { steps: 1 });
    expect(store.canUndo).toBe(before);
    expect(items(store)).toHaveLength(2);
  });
});
