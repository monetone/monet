// ─────────────────────────────────────────────────────────────
// menus-slice.test — Object ▸ Slice ▸ Create from Selection / Delete All (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the items exist with the right gating, and running them creates /
// clears slices (menu → command → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
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
  const r = makeRect(100, 100, 80, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const slices = (store: ArtisanStore) => store.getState().doc.slices ?? [];

describe("menus — Object ▸ Slice", () => {
  it("exposes Create from Selection (enabled with a selection) and Delete All (disabled until slices exist)", () => {
    const { store } = setup();
    const make = itemById(store, "slice-make");
    expect(make).toBeTruthy();
    expect(make!.label).toBe("Create from Selection");
    expect(make!.disabled).toBeFalsy();
    expect(itemById(store, "slice-delete-all")!.disabled).toBe(true); // no slices yet
  });

  it("Create from Selection adds a slice, then Delete All becomes enabled and clears them", () => {
    const { store } = setup();
    itemById(store, "slice-make")!.action!();
    expect(slices(store)).toHaveLength(1);
    expect(itemById(store, "slice-delete-all")!.disabled).toBeFalsy(); // now there is one
    itemById(store, "slice-delete-all")!.action!();
    expect(slices(store)).toHaveLength(0);
  });

  it("disables Create from Selection with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "slice-make")!.disabled).toBe(true);
  });

  it("exposes Create from Guides (enabled with an artboard) and it partitions at the guides", () => {
    const { store } = setup();
    const item = itemById(store, "slice-guides");
    expect(item).toBeTruthy();
    expect(item!.label).toBe("Create from Guides");
    expect(item!.disabled).toBeFalsy(); // makeDocument has one artboard
    // a guide-cross over the default artboard → a 2×2 grid of slices
    const ab = store.getState().doc.artboards[0];
    store.addGuide("v", ab.x + ab.width / 2);
    store.addGuide("h", ab.y + ab.height / 2);
    itemById(store, "slice-guides")!.action!();
    expect(slices(store)).toHaveLength(4);
  });
});
