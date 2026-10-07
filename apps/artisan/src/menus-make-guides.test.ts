// ─────────────────────────────────────────────────────────────
// menus-make-guides.test — View ▸ Make Guides menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the item exists, gates on a selection, and runs the command end-to-end
// (menu → command → store guides).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; disabled?: boolean; shortcut?: string; action?: () => void; items?: MenuItemDef[] };
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

const RED = solid(rgba(220, 0, 0));
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(200, 150, 80, 60, 0, 0, { fill: RED });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "make-guides");

describe("menus — View ▸ Make Guides", () => {
  it("exposes Make Guides (⌘5), enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Make Guides");
    expect(it!.shortcut).toBe("⌘5");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("running it adds the selection's edge guides", () => {
    const { store } = setup();
    item(store)!.action!();
    const set = new Set(store.getState().guides.map((g) => `${g.orientation}:${g.pos}`));
    expect(set).toEqual(new Set(["v:200", "v:280", "h:150", "h:210"]));
  });
});
