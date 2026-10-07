// ─────────────────────────────────────────────────────────────
// menus-select-same-layers.test — Select ▸ Object ▸ All on Same Layers (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the item exists, gates on a selection, and running it grows the
// selection to every object on the selection's layer.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, makeLayer, solid, rgba } from "./engine";
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

const rect = (x: number) => makeRect(x, 0, 40, 40, 0, 0, { fill: solid(rgba(200, 100, 100)) });

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const [a, b] = [rect(0), rect(50)];
  doc.layers[0].items.push(a, b);
  doc.layers.push(makeLayer("Layer 2", [rect(100)]));
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id]);
  return { store, a, b };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Select ▸ Object ▸ All on Same Layers", () => {
  it("exposes the item, enabled with a selection", () => {
    const { store } = setup();
    const it = itemById(store, "obj-same-layers");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("All on Same Layers");
    expect(it!.disabled).toBeFalsy();
  });

  it("disables it with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "obj-same-layers")!.disabled).toBe(true);
  });

  it("running it selects all objects on the selection's layer", () => {
    const { store, a, b } = setup();
    itemById(store, "obj-same-layers")!.action!();
    expect(store.getState().selection.slice().sort()).toEqual([a.id, b.id].sort());
  });
});
