// ─────────────────────────────────────────────────────────────
// commands-effect.test — Effect menu (Drop Shadow / Glow / Clear) (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Adobe Illustrator Effect menu adds non-destructive effects to the
// selection (one per type — re-applying replaces it; different types stack); Clear
// Effects removes them all. Each is an undoable transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const effectTypes = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id)!.effects ?? []).map((e) => e.type);

describe("commands — Effect", () => {
  it("applyEffect adds a drop shadow (default dx/dy/blur/color), undoable", () => {
    const { store, r } = setup();
    commands.applyEffect(store, "drop-shadow");
    const fx = Query.getItem(store.getState().doc, r.id)!.effects!;
    expect(fx[0]).toMatchObject({ type: "drop-shadow", dx: 6, dy: 6, blur: 6 });
    store.undo();
    expect(effectTypes(store, r.id)).toEqual([]);
  });

  it("re-applying the same effect type replaces it (no duplicate)", () => {
    const { store, r } = setup();
    commands.applyEffect(store, "drop-shadow");
    commands.applyEffect(store, "drop-shadow");
    expect(effectTypes(store, r.id)).toEqual(["drop-shadow"]);
  });

  it("different effect types stack", () => {
    const { store, r } = setup();
    commands.applyEffect(store, "drop-shadow");
    commands.applyEffect(store, "glow");
    expect(effectTypes(store, r.id).slice().sort()).toEqual(["drop-shadow", "glow"]);
  });

  it("applyEffect adds an inner glow (default blur/colour), undoable", () => {
    const { store, r } = setup();
    commands.applyEffect(store, "inner-glow");
    const fx = Query.getItem(store.getState().doc, r.id)!.effects!;
    expect(fx[0]).toMatchObject({ type: "inner-glow", blur: 8, color: { r: 255, g: 255, b: 255, a: 0.75 } });
    store.undo();
    expect(effectTypes(store, r.id)).toEqual([]);
  });

  it("inner glow and outer glow stack (separate Illustrator effects)", () => {
    const { store, r } = setup();
    commands.applyEffect(store, "glow");
    commands.applyEffect(store, "inner-glow");
    expect(effectTypes(store, r.id).slice().sort()).toEqual(["glow", "inner-glow"]);
  });

  it("Clear Effects removes all effects from the selection", () => {
    const { store, r } = setup();
    commands.applyEffect(store, "drop-shadow");
    commands.applyEffect(store, "glow");
    commands.clearEffects(store);
    expect(effectTypes(store, r.id)).toEqual([]);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.applyEffect(store, "drop-shadow");
    expect(store.canUndo).toBe(before);
  });
});
