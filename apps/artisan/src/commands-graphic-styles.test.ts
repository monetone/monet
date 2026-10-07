// ─────────────────────────────────────────────────────────────
// commands-graphic-styles.test — Graphic Styles panel commands
// ─────────────────────────────────────────────────────────────
// newGraphicStyle saves the selection's appearance to doc.graphicStyles;
// applyGraphicStyle copies a saved style onto the selection; deleteGraphicStyle
// removes one. All undoable; new/apply are no-ops without a selection.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
  const b = makeRect(60, 0, 40, 40, 0, 0, { fill: solid(BLUE) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  return { store, a, b };
};

describe("commands — Graphic Styles", () => {
  it("newGraphicStyle saves the selected object's appearance in one undoable step", () => {
    const { store, a } = setup();
    store.setSelection([a.id]);
    commands.newGraphicStyle(store);
    const styles = store.getState().doc.graphicStyles ?? [];
    expect(styles.length).toBe(1);
    expect(styles[0].fill).toEqual(solid(RED));
    expect(styles[0].name).toBe("Style 1");
    store.undo();
    expect(store.getState().doc.graphicStyles ?? []).toHaveLength(0);
  });

  it("is a no-op (no dirty) with an empty selection", () => {
    const { store } = setup();
    commands.newGraphicStyle(store); // nothing selected
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().doc.graphicStyles ?? []).toHaveLength(0);
  });

  it("applyGraphicStyle copies a saved style onto a different object", () => {
    const { store, a, b } = setup();
    store.setSelection([a.id]);
    commands.newGraphicStyle(store); // save red
    const id = store.getState().doc.graphicStyles![0].id;
    store.setSelection([b.id]);
    commands.applyGraphicStyle(store, id);
    expect(Query.getItem(store.getState().doc, b.id)!.fill).toEqual(solid(RED));
  });

  it("applyGraphicStyle is a no-op (no dirty) with an empty selection", () => {
    const { store, a } = setup();
    store.setSelection([a.id]);
    commands.newGraphicStyle(store); // save a style (needs a selection)
    const id = store.getState().doc.graphicStyles![0].id;
    store.clearSelection();
    store.replaceDoc(store.getState().doc, { markClean: true }); // clean baseline
    commands.applyGraphicStyle(store, id); // nothing selected
    expect(store.getState().dirty).toBe(false);
  });

  it("deleteGraphicStyle removes a style (bounds-guarded)", () => {
    const { store, a } = setup();
    store.setSelection([a.id]);
    commands.newGraphicStyle(store);
    expect(store.getState().doc.graphicStyles).toHaveLength(1);
    commands.deleteGraphicStyle(store, 5); // out of range → no-op
    expect(store.getState().doc.graphicStyles).toHaveLength(1);
    commands.deleteGraphicStyle(store, 0);
    expect(store.getState().doc.graphicStyles).toHaveLength(0);
  });
});
