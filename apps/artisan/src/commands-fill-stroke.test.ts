// ─────────────────────────────────────────────────────────────
// commands-fill-stroke.test — Fill/Stroke toolbar controls (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Adobe Illustrator toolbar — X toggles the active fill/stroke
// target, Shift+X swaps fill ↔ stroke, D resets to default colours (white fill,
// black 1-pt stroke). Each applies to the defaults AND the current selection.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, defaultStroke, rgba, WHITE, BLACK } from "./engine";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(BLUE)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const item = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!;

describe("commands — Fill/Stroke controls", () => {
  it("toggleFillStroke flips the active paint target (X)", () => {
    const { store } = setup();
    store.setActivePaint("fill");
    commands.toggleFillStroke(store);
    expect(store.getState().activePaint).toBe("stroke");
    commands.toggleFillStroke(store);
    expect(store.getState().activePaint).toBe("fill");
  });

  it("swapFillStroke swaps the selection's fill ↔ stroke, undoable (Shift+X)", () => {
    const { store, r } = setup();
    commands.swapFillStroke(store);
    expect(item(store, r.id).fill).toEqual(solid(BLUE));
    expect(item(store, r.id).stroke.paint).toEqual(solid(RED));
    store.undo();
    expect(item(store, r.id).fill).toEqual(solid(RED));
    expect(item(store, r.id).stroke.paint).toEqual(solid(BLUE));
  });

  it("swapFillStroke with no selection swaps only the defaults (no transaction)", () => {
    const { store } = setup();
    store.clearSelection();
    store.setFill(solid(RED));
    store.setStroke(defaultStroke(solid(BLUE)));
    const before = store.canUndo;
    commands.swapFillStroke(store);
    expect(store.getState().fill).toEqual(solid(BLUE));
    expect(store.getState().stroke.paint).toEqual(solid(RED));
    expect(store.canUndo).toBe(before);
  });

  it("defaultFillStroke sets white fill + black stroke (D)", () => {
    const { store, r } = setup();
    commands.defaultFillStroke(store);
    expect(item(store, r.id).fill).toEqual(solid(WHITE));
    expect(item(store, r.id).stroke.paint).toEqual(solid(BLACK));
    expect(store.getState().fill).toEqual(solid(WHITE));
    expect(store.getState().stroke.paint).toEqual(solid(BLACK));
  });
});
