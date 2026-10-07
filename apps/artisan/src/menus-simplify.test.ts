// ─────────────────────────────────────────────────────────────
// menus-simplify.test — Simplify menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Path ▸ Simplify exists, gates on a selection, and its action
// reduces the selection's anchors (menu → command → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
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
  const p = makePath(
    { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 0 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "simplify");

describe("menus — Simplify", () => {
  it("exposes Object ▸ Path ▸ Simplify, enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Simplify");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("running the action reduces the selected path's anchors", () => {
    const { store, p } = setup();
    item(store)!.action!();
    const it = Query.getItem(store.getState().doc, p.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(2); // collinear midpoint removed
  });
});
