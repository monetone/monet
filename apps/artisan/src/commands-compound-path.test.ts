// ─────────────────────────────────────────────────────────────
// commands-compound-path.test — Object ▸ Compound Path commands (parity)
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore driven through commands.makeCompoundPath /
// releaseCompoundPath. Make combines ≥2 selected paths into one compound and
// selects it; Release breaks it back into paths and selects them; both are a
// single undoable transaction (Illustrator's ⌘8 / ⌥⌘8).

import { describe, it, expect } from "vitest";
import { commands, selectionHasCompound } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const back = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) }); // backmost
  const front = makeRect(30, 30, 40, 40, 0, 0, { fill: solid(BLUE) });
  doc.layers[0].items.push(back, front);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([back.id, front.id]);
  return { store, back, front };
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

describe("commands — Make / Release Compound Path", () => {
  it("Make combines the selection into one compound and selects it", () => {
    const { store } = setup();
    commands.makeCompoundPath(store);
    const its = items(store);
    expect(its.length).toBe(1);
    expect(its[0].type).toBe("compound");
    expect(store.getState().selection).toEqual([its[0].id]); // result selected
    expect(its[0].fill).toEqual(solid(RED)); // backmost paint
    expect(selectionHasCompound(store)).toBe(true);
  });

  it("Make needs ≥2 objects (single selection is a no-op)", () => {
    const { store, back } = setup();
    store.setSelection([back.id]);
    commands.makeCompoundPath(store);
    expect(items(store).length).toBe(2); // unchanged
    expect(items(store).every((it) => it.type === "rect")).toBe(true);
  });

  it("Release breaks the compound back into separate paths and selects them", () => {
    const { store } = setup();
    commands.makeCompoundPath(store);
    commands.releaseCompoundPath(store);
    const its = items(store);
    expect(its.length).toBe(2);
    expect(its.every((it) => it.type === "path")).toBe(true);
    expect(its.every((it) => JSON.stringify(it.fill) === JSON.stringify(solid(RED)))).toBe(true);
    expect(store.getState().selection.length).toBe(2);
    expect(selectionHasCompound(store)).toBe(false);
  });

  it("Make is a single undoable transaction", () => {
    const { store } = setup();
    commands.makeCompoundPath(store);
    expect(items(store).length).toBe(1);
    store.undo();
    const its = items(store);
    expect(its.length).toBe(2); // both rects restored
    expect(its.map((it) => it.type)).toEqual(["rect", "rect"]);
    expect(its[1].fill).toEqual(solid(BLUE)); // front's own colour back
  });

  it("Release disabled-state guard: no compound selected → selectionHasCompound false", () => {
    const { store } = setup();
    expect(selectionHasCompound(store)).toBe(false); // two rects, not a compound
  });
});
