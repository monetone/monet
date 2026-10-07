// ─────────────────────────────────────────────────────────────
// menus-select-artboard.test — Select ▸ All on Active Artboard (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the menu item exists and selects exactly the objects on the ACTIVE
// artboard — switching the active artboard changes what it selects.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, makeArtboard } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };

const findById = (entries: Entry[], id: string): Entry | null => {
  for (const e of entries) {
    if (e.id === id) return e;
    if (e.items) {
      const f = findById(e.items as Entry[], id);
      if (f) return f;
    }
  }
  return null;
};

// Two artboards side by side; object `a` lives on AB0, `b` on AB1.
const setup = (active: number) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.artboards = [makeArtboard("AB0", 0, 0, 200, 200), makeArtboard("AB1", 300, 0, 200, 200)];
  doc.activeArtboard = active;
  const a = makeRect(10, 10, 50, 50);
  const b = makeRect(310, 10, 50, 50);
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  return { store, a, b };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Select ▸ All on Active Artboard", () => {
  it("exposes the item", () => {
    const { store } = setup(0);
    const it = itemById(store, "all-artboard");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("All on Active Artboard");
  });

  it("selects only the objects on the active artboard (AB0)", () => {
    const { store, a } = setup(0);
    itemById(store, "all-artboard")!.action!();
    expect(store.getState().selection).toEqual([a.id]); // a is on AB0; b is not
  });

  it("follows the active artboard when it changes (AB1)", () => {
    const { store, b } = setup(1);
    itemById(store, "all-artboard")!.action!();
    expect(store.getState().selection).toEqual([b.id]); // now only b
  });

  it("REPLACES the existing selection (not additive) and adds no undo entry", () => {
    const { store, a, b } = setup(0);
    store.setSelection([b.id]); // b is on AB1, not the active AB0
    itemById(store, "all-artboard")!.action!();
    expect(store.getState().selection).toEqual([a.id]); // b dropped, a selected
    expect(store.canUndo).toBe(false); // selection-only
  });

  it("falls back to the first artboard when activeArtboard is out of range", () => {
    const { store, a } = setup(99); // index 99, only 2 artboards → falls back to AB0
    itemById(store, "all-artboard")!.action!();
    expect(store.getState().selection).toEqual([a.id]);
  });

  it("does not throw and selects nothing when there are no artboards", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.artboards = [];
    doc.layers[0].items.push(makeRect(10, 10, 50, 50));
    store.replaceDoc(doc, { markClean: true });
    expect(() => itemById(store, "all-artboard")!.action!()).not.toThrow();
    expect(store.getState().selection).toEqual([]);
  });

  it("selects an object straddling the active artboard edge (crossing, not window)", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.artboards = [makeArtboard("AB0", 0, 0, 200, 200)];
    doc.activeArtboard = 0;
    const straddle = makeRect(180, 10, 60, 50); // x 180..240 overlaps the 0..200 edge
    doc.layers[0].items.push(straddle);
    store.replaceDoc(doc, { markClean: true });
    itemById(store, "all-artboard")!.action!();
    expect(store.getState().selection).toEqual([straddle.id]);
  });
});
