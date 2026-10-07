// ─────────────────────────────────────────────────────────────
// commands-send-layer.test — Object ▸ Arrange ▸ Send to Current Layer
// ─────────────────────────────────────────────────────────────
// commands.sendToCurrentLayer moves the selection onto the active layer in one
// undoable step; the menu item gates on a selection and wires to that command.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeLayer, makeRect, solid, rgba } from "./engine";
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

const RED = solid(rgba(220, 0, 0, 1));
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument(); // L0 (bottom)
  const a = makeRect(0, 0, 40, 40, 0, 0, { fill: RED });
  doc.layers[0].items.push(a);
  const top = makeLayer("Layer 2");
  doc.layers.push(top);
  store.replaceDoc(doc, { markClean: true }); // active = top
  store.setSelection([a.id]);
  return { store, a, bottomId: doc.layers[0].id, topId: top.id };
};
const layerItems = (store: ArtisanStore, id: string) => store.getState().doc.layers.find((l) => l.id === id)!.items.map((i) => i.id);
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("commands.sendToCurrentLayer", () => {
  it("moves the selection onto the active layer, undoably, keeping the selection", () => {
    const { store, a, bottomId, topId } = setup();
    commands.sendToCurrentLayer(store);
    expect(layerItems(store, bottomId)).toEqual([]); // pulled off the bottom layer
    expect(layerItems(store, topId)).toEqual([a.id]); // now on the active layer
    expect(store.getState().selection).toEqual([a.id]); // selection preserved

    store.undo();
    expect(layerItems(store, bottomId)).toEqual([a.id]); // back where it was
    expect(layerItems(store, topId)).toEqual([]); // active layer empty again
    expect(store.getState().selection).toEqual([a.id]); // selection intact through the round-trip
  });

  it("is a no-op with an empty selection (no undo entry)", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.sendToCurrentLayer(store);
    expect(store.canUndo).toBe(before);
  });
});

describe("menus — Object ▸ Arrange ▸ Send to Current Layer", () => {
  it("exposes the item (enabled with a selection) and moves the selection on click", () => {
    const { store, a, topId } = setup();
    const item = itemById(store, "send-current-layer");
    expect(item?.label).toBe("Send to Current Layer");
    expect(item?.disabled).toBeFalsy();
    item!.action!();
    expect(layerItems(store, topId)).toEqual([a.id]);
  });

  it("disables with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "send-current-layer")!.disabled).toBe(true);
    for (const id of ["front", "forward", "backward", "back"]) {
      expect(itemById(store, id)!.disabled).toBe(true);
    }
  });
});
