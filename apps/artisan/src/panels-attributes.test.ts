// panels-attributes.test - Attributes panel store transactions

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, defaultStroke, makeDocument, makeGroup, makeRect, noPaint, rgba, solid, type RectItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Attributes");
  const a = makeRect(0, 0, 40, 40, 0, 0, {
    fill: solid(rgba(0, 0, 0)),
    stroke: defaultStroke(solid(rgba(0, 0, 0))),
  });
  const b = makeRect(48, 0, 40, 40, 0, 0, {
    fill: solid(rgba(120, 120, 120)),
    stroke: defaultStroke(noPaint()),
  });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  return { store, a, b };
};

const rect = (store: ArtisanStore, id: string): RectItem => Query.getItem(store.getState().doc, id) as RectItem;

describe("Attributes panel transactions", () => {
  it("toggles fill and stroke overprint on the current selection with undo", () => {
    const { store, a } = setup();
    store.setSelection([a.id]);

    store.transact("Overprint Fill", (doc) => {
      Ops.Prepress.setOverprint(doc, store.getState().selection, "fill", true);
    });
    store.transact("Overprint Stroke", (doc) => {
      Ops.Prepress.setOverprint(doc, store.getState().selection, "stroke", true);
    });

    expect(rect(store, a.id).overprintFill).toBe(true);
    expect(rect(store, a.id).overprintStroke).toBe(true);
    expect(Query.separationPreview(store.getState().doc).overprintObjectCount).toBe(1);

    store.undo();
    expect(rect(store, a.id).overprintFill).toBe(true);
    expect(rect(store, a.id).overprintStroke).toBeUndefined();

    store.undo();
    expect(rect(store, a.id).overprintFill).toBeUndefined();
    expect(Query.separationPreview(store.getState().doc).overprintObjectCount).toBe(0);
  });

  it("applies overprint through selected groups and preserves selection on undo", () => {
    const { store, a, b } = setup();
    const group = makeGroup([a, b]);
    const doc = makeDocument("Grouped Attributes");
    doc.layers[0].items.push(group);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([group.id]);

    store.transact("Overprint Fill", (d) => {
      Ops.Prepress.setOverprint(d, store.getState().selection, "fill", true);
    });

    expect(rect(store, a.id).overprintFill).toBe(true);
    expect(rect(store, b.id).overprintFill).toBe(true);
    expect(store.getState().selection).toEqual([group.id]);

    store.undo();
    expect(rect(store, a.id).overprintFill).toBeUndefined();
    expect(rect(store, b.id).overprintFill).toBeUndefined();
    expect(store.getState().selection).toEqual([group.id]);
  });
});
