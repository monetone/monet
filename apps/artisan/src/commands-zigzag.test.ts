// ─────────────────────────────────────────────────────────────
// commands-zigzag.test — Zig Zag command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Object ▸ Path ▸ Zig Zag distorts the selection in one undoable
// transaction (live shapes bake to a zig-zagged path).

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!;

describe("commands.zigZag", () => {
  it("zig-zags the selected shape with the default ridges, undoable", () => {
    const { store, r } = setup();
    commands.zigZag(store); // default size 10, 4 ridges, corner

    const it = itemOf(store, r.id);
    expect(it.type).toBe("path"); // rect baked to a zig-zagged path
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(20); // 4 segs × (node + 4 ridges)

    store.undo();
    expect(itemOf(store, r.id).type).toBe("rect"); // restored in one transaction
  });

  it("honours an explicit ridge count and smooth mode", () => {
    const { store, r } = setup();
    commands.zigZag(store, { size: 8, ridges: 2, smooth: true });
    const it = itemOf(store, r.id);
    if (it.type !== "path") throw new Error("expected path");
    expect(it.geometry.anchors).toHaveLength(12); // 4 segs × (node + 2 ridges)
    expect(it.geometry.anchors.some((a) => Math.abs(a.handleOut.x) + Math.abs(a.handleOut.y) > 1e-9)).toBe(true);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.zigZag(store);
    expect(store.canUndo).toBe(before);
  });
});
