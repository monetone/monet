// ─────────────────────────────────────────────────────────────
// menus-expand.test — Object ▸ Expand menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the Object ▸ Expand item exists, gates on a selection, and running it
// converts a live shape to an editable path in one undoable step (menu → command
// → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, Query, solid, noPaint, defaultStroke, rgba } from "./engine";
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
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)), stroke: defaultStroke(noPaint()) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Object ▸ Expand", () => {
  it("exposes the Expand item, enabled with a selection", () => {
    const { store } = setup();
    const it = itemById(store, "expand");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Expand");
    expect(it!.disabled).toBeFalsy();
  });

  it("disables Expand with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "expand")!.disabled).toBe(true);
  });

  it("running Expand converts the live shape to a path, undoable", () => {
    const { store, r } = setup();
    expect(Query.getItem(store.getState().doc, r.id)!.type).toBe("rect");
    itemById(store, "expand")!.action!();
    expect(Query.getItem(store.getState().doc, r.id)!.type).toBe("path");

    store.undo();
    expect(Query.getItem(store.getState().doc, r.id)!.type).toBe("rect"); // restored
  });
});
