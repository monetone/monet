// ─────────────────────────────────────────────────────────────
// menus-select-objects.test — Select ▸ Object menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Select ▸ Object ▸ {Text Objects, Stray Points, Clipping Masks} exist,
// and their actions select that kind (menu → command → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeText, makeRect, solid, rgba } from "./engine";
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
  const t = makeText("hi", 0, 0); // point text
  const area = makeText("area", 0, 0);
  area.boxWidth = 200;
  area.boxHeight = 80; // area text
  const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(t, area, r);
  store.replaceDoc(doc, { markClean: true });
  return { store, t, area, r };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Select Object", () => {
  it("exposes Text / Point Text / Area Text / Stray Points / Clipping Masks", () => {
    const { store } = setup();
    for (const [id, label] of [
      ["obj-text", "Text Objects"],
      ["obj-point-text", "Point Text Objects"],
      ["obj-area-text", "Area Text Objects"],
      ["obj-stray", "Stray Points"],
      ["obj-clip", "Clipping Masks"],
    ] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
    }
  });

  it("running Text Objects selects every text object", () => {
    const { store, t, area } = setup();
    itemById(store, "obj-text")!.action!();
    expect(store.getState().selection.slice().sort()).toEqual([t.id, area.id].sort());
  });

  it("running Point / Area Text selects only that kind", () => {
    const { store, t, area } = setup();
    itemById(store, "obj-point-text")!.action!();
    expect(store.getState().selection).toEqual([t.id]);
    itemById(store, "obj-area-text")!.action!();
    expect(store.getState().selection).toEqual([area.id]);
  });
});
