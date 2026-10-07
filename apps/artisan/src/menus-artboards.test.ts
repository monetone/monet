// ─────────────────────────────────────────────────────────────
// menus-artboards.test — Object ▸ Artboards ▸ Fit to Selected Art / Artwork (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the items exist with the right gating, and Fit to Selected Art resizes
// the active artboard (menu → command → document).

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
  doc.artboards = [{ id: "A1", name: "AB", x: 0, y: 0, width: 400, height: 300 }];
  doc.activeArtboard = 0;
  const r = makeRect(100, 100, 80, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const board = (store: ArtisanStore) => store.getState().doc.artboards[0];

describe("menus — Object ▸ Artboards", () => {
  it("exposes Fit to Selected Art (enabled with a selection) and Fit to Artwork Bounds", () => {
    const { store } = setup();
    const sel = itemById(store, "ab-fit-selection");
    expect(sel).toBeTruthy();
    expect(sel!.label).toBe("Fit to Selected Art");
    expect(sel!.disabled).toBeFalsy();
    expect(itemById(store, "ab-fit-artwork")!.label).toBe("Fit to Artwork Bounds");
  });

  it("disables Fit to Selected Art with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "ab-fit-selection")!.disabled).toBe(true);
  });

  it("Fit to Selected Art resizes the active artboard to the selection", () => {
    const { store } = setup();
    itemById(store, "ab-fit-selection")!.action!();
    const a = board(store);
    expect({ x: a.x, y: a.y, w: a.width, h: a.height }).toEqual({ x: 100, y: 100, w: 80, h: 60 });
  });

  it("gates Rearrange All Artboards on ≥ 2 artboards, and lays them in a row", () => {
    const { store } = setup(); // one artboard
    expect(itemById(store, "ab-rearrange")!.disabled).toBe(true);
    store.getState().doc.artboards.push({ id: "A2", name: "AB2", x: 600, y: 300, width: 120, height: 90 });
    store.replaceDoc(store.getState().doc, { markClean: true });
    expect(itemById(store, "ab-rearrange")!.disabled).toBeFalsy();
    itemById(store, "ab-rearrange")!.action!();
    const abs = store.getState().doc.artboards;
    expect(abs[1].x).toBe(abs[0].x + abs[0].width + 20); // second artboard sits to the right
    expect(abs[1].y).toBe(abs[0].y); // top-aligned
  });

  it("Convert to Artboards adds an artboard from the selection (gated on a selection)", () => {
    const { store } = setup(); // a rect at (100,100,80,60) is selected
    const before = store.getState().doc.artboards.length;
    itemById(store, "ab-convert")!.action!();
    const abs = store.getState().doc.artboards;
    expect(abs.length).toBe(before + 1);
    const last = abs[abs.length - 1];
    expect({ x: last.x, y: last.y, w: last.width, h: last.height }).toEqual({ x: 100, y: 100, w: 80, h: 60 });

    store.clearSelection();
    expect(itemById(store, "ab-convert")!.disabled).toBe(true);
  });
});
