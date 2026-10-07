// ─────────────────────────────────────────────────────────────
// menus-free-distort.test — Effect ▸ Distort & Transform ▸ Free Distort (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the Free Distort item exists, gates on a selection, and running it
// remaps the selection's bounding box (top edge pulled in) in one undoable step.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";
import type { PathItem } from "./engine";

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
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const tl = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors[0].point;

describe("menus — Effect ▸ Free Distort", () => {
  it("exposes the Free Distort item, enabled with a selection", () => {
    const { store } = setup();
    const it = itemById(store, "fx-free-distort");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Free Distort");
    expect(it!.disabled).toBeFalsy();
  });

  it("disables Free Distort with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "fx-free-distort")!.disabled).toBe(true);
  });

  it("running Free Distort pulls the top corners inward, undoable", () => {
    const { store, p } = setup();
    itemById(store, "fx-free-distort")!.action!(); // default perspective
    expect(tl(store, p.id)).toEqual({ x: 20, y: 0 }); // top-left pulled in 20%

    store.undo();
    expect(tl(store, p.id)).toEqual({ x: 0, y: 0 }); // restored
  });
});
