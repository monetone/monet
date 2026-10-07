// ─────────────────────────────────────────────────────────────
// menus-edit-colors.test — Edit Colors menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Edit ▸ Edit Colors ▸ {Invert Colors, Convert to Grayscale} exist, gate
// on a selection, and their actions recolour it (menu → command → op → document).

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
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(100, 150, 200)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Edit Colors", () => {
  it("exposes Invert Colors and Convert to Grayscale, enabled with a selection", () => {
    const { store } = setup();
    for (const [id, label] of [["invert-colors", "Invert Colors"], ["grayscale", "Convert to Grayscale"], ["saturate", "Saturate"], ["desaturate", "Desaturate"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables the items with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "invert-colors")!.disabled).toBe(true);
  });

  it("running Invert Colors recolours the selected shape", () => {
    const { store, r } = setup();
    itemById(store, "invert-colors")!.action!();
    const f = Query.getItem(store.getState().doc, r.id)!.fill;
    expect(f.type === "solid" ? f.color : null).toEqual({ r: 155, g: 105, b: 55, a: 1 });
  });

  it("running Saturate recolours the selected shape", () => {
    const { store, r } = setup();
    itemById(store, "saturate")!.action!();
    const f = Query.getItem(store.getState().doc, r.id)!.fill;
    expect(f.type === "solid" ? f.color : null).toEqual({ r: 80, g: 155, b: 230, a: 1 });
  });
});
