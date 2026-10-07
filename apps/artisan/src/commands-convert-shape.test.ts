// ─────────────────────────────────────────────────────────────
// commands-convert-shape.test — Convert to Shape command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Convert to Shape replaces the selection with a primitive
// shape in one undoable transaction, and selects the result.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 50, y: 80 }) ] }, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const itemOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id);

describe("commands.convertToShape", () => {
  it("replaces the selection with an ellipse, selects it, undoable", () => {
    const { store, p } = setup();
    commands.convertToShape(store, "ellipse");

    expect(itemOf(store, p.id)).toBeNull(); // original replaced
    const sel = store.getState().selection;
    expect(sel).toHaveLength(1);
    expect(itemOf(store, sel[0])!.type).toBe("ellipse");

    store.undo();
    expect(itemOf(store, p.id)!.type).toBe("path"); // restored in one transaction
  });

  it("converts to a rounded rectangle", () => {
    const { store } = setup();
    commands.convertToShape(store, "rounded-rectangle");
    const it = itemOf(store, store.getState().selection[0])!;
    expect(it.type).toBe("rect");
    if (it.type === "rect") expect(it.rx).toBeGreaterThan(0);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.convertToShape(store, "ellipse");
    expect(store.canUndo).toBe(before);
  });
});
