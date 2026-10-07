// ─────────────────────────────────────────────────────────────
// menus-other-layers.test — Object ▸ Lock/Hide ▸ Other Layers (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the two items exist, gate on a multi-layer document, and lock/hide
// every layer except the selection's layer (or the active layer when nothing is
// selected) — menu → command → op → document.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeLayer, makeRect, makeGroup } from "./engine";
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

// Three layers; a selectable item lives on L1. The active layer defaults to the
// top (last) layer, L2.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const L0 = doc.layers[0];
  const L1 = makeLayer("L1");
  const L2 = makeLayer("L2");
  const item = makeRect(10, 10, 20, 20);
  L1.items.push(item);
  doc.layers.push(L1, L2);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([item.id]);
  return { store, L0, L1, L2, item };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const layer = (store: ArtisanStore, id: string) => store.getState().doc.layers.find((l) => l.id === id)!;

describe("menus — Object ▸ Lock/Hide Other Layers", () => {
  it("exposes both items, enabled in a multi-layer document", () => {
    const { store } = setup();
    expect(itemById(store, "lockother")!.label).toBe("Lock Other Layers");
    expect(itemById(store, "lockother")!.disabled).toBeFalsy();
    expect(itemById(store, "hideother")!.label).toBe("Hide Other Layers");
    expect(itemById(store, "hideother")!.disabled).toBeFalsy();
  });

  it("disables both in a single-layer document", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    expect(itemById(store, "lockother")!.disabled).toBe(true);
    expect(itemById(store, "hideother")!.disabled).toBe(true);
  });

  it("Lock Other Layers locks all but the selection's layer, undoably", () => {
    const { store, L0, L1, L2 } = setup();
    itemById(store, "lockother")!.action!();
    expect(layer(store, L0.id).locked).toBe(true);
    expect(layer(store, L1.id).locked).toBe(false); // the selection's layer is kept
    expect(layer(store, L2.id).locked).toBe(true);

    store.undo();
    expect(layer(store, L0.id).locked).toBe(false); // restored
  });

  it("Hide Other Layers hides all but the selection's layer, keeping the selection", () => {
    const { store, L0, L1, L2, item } = setup();
    itemById(store, "hideother")!.action!();
    expect(layer(store, L0.id).visible).toBe(false);
    expect(layer(store, L1.id).visible).toBe(true); // kept
    expect(layer(store, L2.id).visible).toBe(false);
    expect(store.getState().selection).toEqual([item.id]); // selection survives (its layer stays visible)
  });

  it("keeps EVERY layer that holds selection (union) when the selection spans layers", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const L0 = doc.layers[0];
    const L1 = makeLayer("L1");
    const L2 = makeLayer("L2");
    const item1 = makeRect(10, 10, 20, 20);
    const item2 = makeRect(30, 30, 20, 20);
    L1.items.push(item1);
    L2.items.push(item2);
    doc.layers.push(L1, L2);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([item1.id, item2.id]); // spans L1 and L2
    itemById(store, "lockother")!.action!();
    expect(layer(store, L1.id).locked).toBe(false); // both selection layers kept
    expect(layer(store, L2.id).locked).toBe(false);
    expect(layer(store, L0.id).locked).toBe(true); // the only other layer is locked
  });

  it("keeps the layer of a selected item nested inside a group", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const L0 = doc.layers[0];
    const L1 = makeLayer("L1");
    const L2 = makeLayer("L2");
    const inner = makeRect(10, 10, 20, 20);
    L1.items.push(makeGroup([inner])); // the item is nested in a group on L1
    doc.layers.push(L1, L2);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([inner.id]);
    itemById(store, "lockother")!.action!();
    expect(layer(store, L1.id).locked).toBe(false); // resolved to the group's layer
    expect(layer(store, L0.id).locked).toBe(true);
    expect(layer(store, L2.id).locked).toBe(true);
  });

  it("adds no undo entry when there is nothing to lock", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const L0 = doc.layers[0];
    L0.locked = true;
    const L1 = makeLayer("L1");
    const L2 = makeLayer("L2");
    L2.locked = true; // every non-selection layer is already locked
    const item = makeRect(10, 10, 20, 20);
    L1.items.push(item);
    doc.layers.push(L1, L2);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([item.id]);
    itemById(store, "lockother")!.action!();
    expect(store.canUndo).toBe(false); // Immer no-op ⇒ no spurious undo step
  });

  it("with no selection, keeps the ACTIVE layer (the top one)", () => {
    const { store, L0, L1, L2 } = setup();
    store.clearSelection();
    itemById(store, "lockother")!.action!();
    expect(layer(store, L2.id).locked).toBe(false); // active layer kept
    expect(layer(store, L0.id).locked).toBe(true);
    expect(layer(store, L1.id).locked).toBe(true);
  });
});
