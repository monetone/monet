// ─────────────────────────────────────────────────────────────
// menus-round-corners.test — Round Corners menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Path ▸ Round Corners exists, gates on a selection, and its
// action rounds the selection end-to-end (menu → command → op → document).

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
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "round-corners");

describe("menus — Round Corners", () => {
  it("exposes Object ▸ Path ▸ Round Corners, enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Round Corners");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("running the action rounds the selected shape", () => {
    const { store, r } = setup();
    item(store)!.action!();
    const it = Query.getItem(store.getState().doc, r.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(8);
  });
});

const fxItem = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "fx-round-corners");

describe("menus — Effect ▸ Round Corners", () => {
  it("exposes the Effect-menu entry (Illustrator's home for Round Corners), gated on a selection", () => {
    const { store } = setup();
    const it = fxItem(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Round Corners");
    expect(it!.disabled).toBeFalsy();
    store.clearSelection();
    expect(fxItem(store)!.disabled).toBe(true);
  });

  it("runs the same op as the Path entry, rounding the shape", () => {
    const { store, r } = setup();
    fxItem(store)!.action!();
    const it = Query.getItem(store.getState().doc, r.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(8);
  });
});
