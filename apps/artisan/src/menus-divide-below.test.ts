// ─────────────────────────────────────────────────────────────
// menus-divide-below.test — Object ▸ Path ▸ Divide Objects Below (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the menu item exists, is enabled only with EXACTLY one object selected
// (the cutter), and running it splits the object below and removes the cutter in
// one undoable step (menu → command → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";
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

// a full-square target, plus a cutter covering its right half.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const target = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const cutter = makeRect(50, -10, 100, 120);
  doc.layers[0].items.push(target, cutter);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([cutter.id]);
  return { store, target, cutter };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Object ▸ Path ▸ Divide Objects Below", () => {
  it("exposes the item, enabled with exactly one object selected", () => {
    const { store } = setup();
    const it = itemById(store, "divide-below");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Divide Objects Below");
    expect(it!.disabled).toBeFalsy();
  });

  it("disables with zero or multiple objects selected", () => {
    const { store, target, cutter } = setup();
    store.clearSelection();
    expect(itemById(store, "divide-below")!.disabled).toBe(true);
    store.setSelection([target.id, cutter.id]);
    expect(itemById(store, "divide-below")!.disabled).toBe(true);
  });

  it("running it splits the object below, removes the cutter, and is undoable", () => {
    const { store, target, cutter } = setup();
    itemById(store, "divide-below")!.action!();
    const items = store.getState().doc.layers[0].items;
    expect(items).toHaveLength(2); // two pieces
    expect(Query.getItem(store.getState().doc, cutter.id)).toBeFalsy(); // cutter consumed
    expect(Query.getItem(store.getState().doc, target.id)).toBeFalsy(); // target replaced
    expect(store.getState().selection).toHaveLength(2); // pieces selected

    store.undo();
    const restored = store.getState().doc.layers[0].items;
    expect(restored).toHaveLength(2); // target + cutter restored
    expect(Query.getItem(store.getState().doc, cutter.id)).toBeTruthy();
  });
});
