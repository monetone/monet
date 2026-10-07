// ─────────────────────────────────────────────────────────────
// menus-pucker-bloat.test — Pucker & Bloat menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Effect ▸ Distort & Transform ▸ Pucker & Bloat exists, gates on a
// selection, and its action curves the selection (menu → command → op → doc).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import type { PathItem } from "./engine";
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
    { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "fx-pucker-bloat");

describe("menus — Pucker & Bloat", () => {
  it("exposes Effect ▸ Distort & Transform ▸ Pucker & Bloat, enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Pucker & Bloat");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("running the action sets radial handles on the selected path", () => {
    const { store, p } = setup();
    item(store)!.action!();
    const it = Query.getItem(store.getState().doc, p.id) as PathItem;
    expect(it.geometry.anchors[0].handleOut).toEqual({ x: -25, y: -25 });
  });
});
