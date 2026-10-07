// ─────────────────────────────────────────────────────────────
// menus-transform-each.test — Transform Each menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Transform ▸ Transform Each exists, gates on a selection, and
// its action transforms the selection (menu → command → op → document).

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
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "transform-each");

describe("menus — Transform Each", () => {
  it("exposes Object ▸ Transform ▸ Transform Each, enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Transform Each");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("running the action scales the selected shape in place", () => {
    const { store, r } = setup();
    item(store)!.action!(); // default 50%
    const b = Query.worldBounds(store.getState().doc, r.id)!;
    expect([b.x, b.y, b.width, b.height]).toEqual([10, 10, 20, 20]); // halved, centre (20,20) fixed
  });
});
