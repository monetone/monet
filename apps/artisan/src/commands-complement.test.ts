// ─────────────────────────────────────────────────────────────
// commands-complement.test — Color panel "Complement" (parity)
// ─────────────────────────────────────────────────────────────
// Integration: commands.complementColor replaces the active fill/stroke colour
// with its colour-wheel complement, applied to the selection in one undoable
// step. No-op for a non-solid paint.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, defaultStroke, linearGradient, rgba } from "./engine";
import type { PathItem } from "./engine";

const RED = rgba(220, 0, 0);
const CYAN = rgba(0, 220, 220); // complement of RED

const fillOf = (store: ArtisanStore, id: string) => {
  const f = (Query.getItem(store.getState().doc, id) as { fill: { type: string; color?: typeof RED } }).fill;
  return f.type === "solid" ? f.color! : null;
};

const setup = (fill = solid(RED)) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};

describe("commands.complementColor", () => {
  it("complements the selection's fill (red → cyan), undoably", () => {
    const { store, r } = setup();
    commands.complementColor(store);
    expect(fillOf(store, r.id)).toEqual(CYAN);

    store.undo();
    expect(fillOf(store, r.id)).toEqual(RED);
  });

  it("complements the active stroke when stroke is the target", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(10, 10, 10)), stroke: defaultStroke(solid(RED)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    store.setActivePaint("stroke");
    commands.complementColor(store);
    const sp = (Query.getItem(store.getState().doc, r.id) as PathItem).stroke.paint;
    expect(sp.type === "solid" ? sp.color : null).toEqual(CYAN);
    expect(fillOf(store, r.id)).toEqual(rgba(10, 10, 10)); // fill untouched
  });

  it("is a no-op for a non-solid (gradient) fill — no undo entry", () => {
    const { store, r } = setup(linearGradient());
    const before = store.canUndo;
    commands.complementColor(store);
    expect(store.canUndo).toBe(before);
    expect((Query.getItem(store.getState().doc, r.id) as PathItem).fill.type).toBe("gradient"); // unchanged
  });

  it("with no selection, complements the default fill (no document change)", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    store.setFill(solid(RED));
    commands.complementColor(store);
    const f = store.getState().fill;
    expect(f.type === "solid" ? f.color : null).toEqual(CYAN);
    expect(store.canUndo).toBe(false); // no selection → no document edit
  });
});

const INV = rgba(35, 255, 255); // invert (negative) of RED

describe("commands.invertColor", () => {
  it("inverts the selection's fill (red → 35,255,255), undoably", () => {
    const { store, r } = setup();
    commands.invertColor(store);
    expect(fillOf(store, r.id)).toEqual(INV);

    store.undo();
    expect(fillOf(store, r.id)).toEqual(RED);
  });

  it("inverts the active stroke when stroke is the target", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(10, 10, 10)), stroke: defaultStroke(solid(RED)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    store.setActivePaint("stroke");
    commands.invertColor(store);
    const sp = (Query.getItem(store.getState().doc, r.id) as PathItem).stroke.paint;
    expect(sp.type === "solid" ? sp.color : null).toEqual(INV);
    expect(fillOf(store, r.id)).toEqual(rgba(10, 10, 10)); // fill untouched
  });

  it("is a no-op for a non-solid (gradient) fill — no undo entry", () => {
    const { store, r } = setup(linearGradient());
    const before = store.canUndo;
    commands.invertColor(store);
    expect(store.canUndo).toBe(before);
    expect((Query.getItem(store.getState().doc, r.id) as PathItem).fill.type).toBe("gradient");
  });
});
