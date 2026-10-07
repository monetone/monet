// ─────────────────────────────────────────────────────────────
// commands-select-objects.test — Select ▸ Object command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Select ▸ Object sets the selection to every object of the kind.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeText, makeRect, makePath, makeAnchor as anchor, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const t = makeText("hi", 0, 0); // point text
  const area = makeText("area", 0, 0);
  area.boxWidth = 200;
  area.boxHeight = 80; // area text
  const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const stray = makePath({ closed: false, anchors: [anchor({ x: 5, y: 5 })] });
  doc.layers[0].items.push(t, area, r, stray);
  store.replaceDoc(doc, { markClean: true });
  return { store, t, area, r, stray };
};

describe("commands.selectObjects", () => {
  it("selects all text objects", () => {
    const { store, t, area } = setup();
    commands.selectObjects(store, "text");
    expect(store.getState().selection.slice().sort()).toEqual([t.id, area.id].sort());
  });

  it("selects only point text", () => {
    const { store, t } = setup();
    commands.selectObjects(store, "point-text");
    expect(store.getState().selection).toEqual([t.id]);
  });

  it("selects only area text and remembers the query for Reselect", () => {
    const { store, area } = setup();
    commands.selectObjects(store, "area-text");
    expect(store.getState().selection).toEqual([area.id]);
    expect(store.getState().lastSelectQuery).toEqual({ kind: "object", k: "area-text" });
  });

  it("selects all stray points", () => {
    const { store, stray } = setup();
    commands.selectObjects(store, "stray-points");
    expect(store.getState().selection).toEqual([stray.id]);
  });

  it("clears the selection when nothing matches", () => {
    const { store, r } = setup();
    store.setSelection([r.id]);
    commands.selectObjects(store, "clipping-masks"); // none present
    expect(store.getState().selection).toEqual([]);
  });
});
