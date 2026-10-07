// ─────────────────────────────────────────────────────────────
// panels-separations.test — Separations panel store transactions
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, defaultStroke, makeDocument, makeRect, noPaint, rgba, solid } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Separations");
  const rect = makeRect(0, 0, 40, 40, 0, 0, {
    fill: solid(rgba(0, 0, 0)),
    stroke: defaultStroke(noPaint()),
  });
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, rect };
};

const preview = (store: ArtisanStore) => Query.separationPreview(store.getState().doc);

describe("Separations panel transactions", () => {
  it("toggles overprint preview through an undoable transaction", () => {
    const { store } = setup();

    store.transact("Overprint Preview", (doc) => {
      Ops.Prepress.setOverprintPreview(doc, true);
    });

    expect(preview(store).overprintPreview).toBe(true);
    expect(store.getState().dirty).toBe(true);

    store.undo();
    expect(preview(store).overprintPreview).toBe(false);
  });

  it("reflects selected-object overprint edits in separation counts", () => {
    const { store, rect } = setup();

    store.transact("Overprint Fill", (doc) => {
      Ops.Prepress.setOverprint(doc, [rect.id], "fill", true);
    });

    expect(preview(store).overprintObjectCount).toBe(1);
    expect(preview(store).plates.find((plate) => plate.name === "Black")?.overprintUses).toBe(1);

    store.undo();
    expect(preview(store).overprintObjectCount).toBe(0);
  });
});
