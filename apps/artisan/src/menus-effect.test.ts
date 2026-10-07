// ─────────────────────────────────────────────────────────────
// menus-effect.test — Effect ▸ Stylize menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Effect ▸ {Outer Glow, Inner Glow} exist, gate on a selection, and their
// actions add the matching non-destructive effect (menu → command → op → doc).

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
const effectTypes = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id)!.effects ?? []).map((e) => e.type);

describe("menus — Effect ▸ Stylize", () => {
  it("exposes Outer Glow and Inner Glow, enabled with a selection", () => {
    const { store } = setup();
    for (const [id, label] of [["glow", "Outer Glow"], ["inner-glow", "Inner Glow"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables Inner Glow with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "inner-glow")!.disabled).toBe(true);
  });

  it("running Inner Glow adds an inner-glow effect to the selection", () => {
    const { store, r } = setup();
    itemById(store, "inner-glow")!.action!();
    expect(effectTypes(store, r.id)).toEqual(["inner-glow"]);
  });
});
