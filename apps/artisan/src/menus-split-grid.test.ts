// ─────────────────────────────────────────────────────────────
// menus-split-grid.test — Split Into Grid menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Path ▸ Split Into Grid exists, gates on a selection, and its
// action splits the selection end-to-end (menu → command → op → document).

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

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "split-grid");

describe("menus — Split Into Grid", () => {
  it("exposes Object ▸ Path ▸ Split Into Grid, enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Split Into Grid");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("running the action replaces the shape with a grid group", () => {
    const { store, r } = setup();
    item(store)!.action!();
    expect(Query.getItem(store.getState().doc, r.id)).toBeNull();
    const g = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    expect(g.type).toBe("group");
    if (g.type === "group") expect(g.children).toHaveLength(4);
  });
});
