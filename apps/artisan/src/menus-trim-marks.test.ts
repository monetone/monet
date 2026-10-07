// ─────────────────────────────────────────────────────────────
// menus-trim-marks.test — Create Trim Marks menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Create Trim Marks exists, gates on a selection, and its action
// adds the marks end-to-end (menu → command → op → document).

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
  const r = makeRect(100, 100, 200, 150, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "trim-marks");

describe("menus — Create Trim Marks", () => {
  it("exposes Object ▸ Create Trim Marks, enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Create Trim Marks");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("running the action adds the Trim Marks group", () => {
    const { store } = setup();
    item(store)!.action!();
    const sel = store.getState().selection;
    const g = Query.getItem(store.getState().doc, sel[0])!;
    expect(g.type).toBe("group");
    expect(g.name).toBe("Trim Marks");
    if (g.type === "group") expect(g.children).toHaveLength(8);
  });
});
