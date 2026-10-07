// ─────────────────────────────────────────────────────────────
// commands-roughen.test — Roughen command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Effect ▸ Distort & Transform ▸ Roughen jitters the selection in
// one undoable transaction.

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
const count = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors.length;

describe("commands.roughen", () => {
  it("roughens the selection with the default detail, undoable", () => {
    const { store, p } = setup();
    expect(count(store, p.id)).toBe(4);
    commands.roughen(store); // default detail 2 → 4 segs × 3 = 12
    expect(count(store, p.id)).toBe(12);

    store.undo();
    expect(count(store, p.id)).toBe(4); // restored in one transaction
  });

  it("honours explicit options (detail + smooth)", () => {
    const { store, p } = setup();
    commands.roughen(store, { size: 6, detail: 1, smooth: true });
    const it = Query.getItem(store.getState().doc, p.id) as PathItem;
    expect(it.geometry.anchors).toHaveLength(8); // 4 segs × 2
    expect(it.geometry.anchors.some((a) => Math.abs(a.handleOut.x) + Math.abs(a.handleOut.y) > 1e-9)).toBe(true);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.roughen(store);
    expect(store.canUndo).toBe(before);
  });
});
