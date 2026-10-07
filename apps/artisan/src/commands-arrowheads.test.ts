// ─────────────────────────────────────────────────────────────
// commands-arrowheads.test — Effect ▸ Stylize ▸ Add Arrowheads (command path)
// ─────────────────────────────────────────────────────────────
// commands.addArrowheads bakes arrowhead shapes onto the selected stroked paths
// in one undoable step and selects the resulting "Arrowheads" group.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, defaultStroke, solid, rgba, Query } from "./engine";

const RED = rgba(220, 0, 0, 1);
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { stroke: { ...defaultStroke(solid(RED)), width: 10 } });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};

describe("commands.addArrowheads", () => {
  it("wraps the selected line in an Arrowheads group, selects it, undoably", () => {
    const { store, p } = setup();
    commands.addArrowheads(store, "end");
    const selection = store.getState().selection;
    expect(selection.length).toBe(1);
    expect(selection[0]).not.toBe(p.id);
    const grp = Query.getItem(store.getState().doc, selection[0])!;
    expect(grp.type).toBe("group");
    expect(grp.type === "group" && grp.children.length).toBe(2); // original + one head

    store.undo();
    expect(Query.getItem(store.getState().doc, p.id)!.type).toBe("path"); // restored
    expect(store.getState().selection).toEqual([p.id]);
  });

  it("Both adds two heads (original + start + end)", () => {
    const { store } = setup();
    commands.addArrowheads(store, "both");
    const grp = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    expect(grp.type === "group" && grp.children.length).toBe(3);
  });

  it("threads the chosen style through to the baked head (square ⇒ 4-anchor closed quad)", () => {
    const { store } = setup();
    commands.addArrowheads(store, "end", "square");
    const grp = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    const head = grp.type === "group" && grp.children[1];
    expect(head && head.type === "path" && head.geometry.closed).toBe(true);
    expect(head && head.type === "path" && head.geometry.anchors.length).toBe(4); // square, not the 3-point triangle
  });

  it("defaults to the triangle style when none is given", () => {
    const { store } = setup();
    commands.addArrowheads(store, "end");
    const grp = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    const head = grp.type === "group" && grp.children[1];
    expect(head && head.type === "path" && head.geometry.anchors.length).toBe(3); // classic triangle
  });

  it("is a no-op with an empty selection (no undo entry)", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.addArrowheads(store, "end");
    expect(store.canUndo).toBe(before);
  });
});
