// ─────────────────────────────────────────────────────────────
// menus-hide-above.test — Object ▸ Hide All Artwork Above (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the menu item exists, gates on a selection, and running it hides every
// object above the selection (menu → command → op → document, undoable). The
// selection stays selected (it sits below the hidden art).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query } from "./engine";
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

// a (back) · b · c · d (front).
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const rects = [makeRect(0, 0, 10, 10), makeRect(0, 0, 10, 10), makeRect(0, 0, 10, 10), makeRect(0, 0, 10, 10)];
  for (const r of rects) doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rects[1].id]); // select b
  return { store, rects };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const isVisible = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!.visible;

describe("menus — Object ▸ Hide All Artwork Above", () => {
  it("exposes the item, enabled with a selection, between Hide Selection and Hide Other Layers", () => {
    const { store } = setup();
    const it = itemById(store, "hideabove");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Hide All Artwork Above");
    expect(it!.disabled).toBeFalsy();
    // ordering: hide → hideabove → hideother in the Object menu
    const object = (buildMenus(store, store.getState()) as unknown as Entry[]).find((e) => e.id === "object")!;
    const ids = (object.items as Entry[]).map((i) => i.id);
    expect(ids.indexOf("hideabove")).toBeGreaterThan(ids.indexOf("hide"));
    expect(ids.indexOf("hideabove")).toBeLessThan(ids.indexOf("hideother"));
  });

  it("disables it with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "hideabove")!.disabled).toBe(true);
  });

  it("running it hides the objects above the selection, undoably", () => {
    const { store, rects } = setup();
    const [a, b, c, d] = rects;
    itemById(store, "hideabove")!.action!();
    expect(isVisible(store, c.id)).toBe(false); // above b
    expect(isVisible(store, d.id)).toBe(false);
    expect(isVisible(store, a.id)).toBe(true); // below
    expect(isVisible(store, b.id)).toBe(true); // the selection itself

    store.undo();
    expect(isVisible(store, c.id)).toBe(true); // restored
  });

  it("keeps the selection (unlike Hide Selection) and adds no undo entry when nothing is above", () => {
    const { store, rects } = setup();
    const top = rects[3];
    store.setSelection([top.id]); // already the front-most → nothing above
    const undoBefore = store.canUndo;
    commands.hideAllArtworkAbove(store);
    expect(store.getState().selection).toEqual([top.id]); // selection preserved
    expect(store.canUndo).toBe(undoBefore); // Immer no-op ⇒ no spurious undo step
    expect(rects.every((r) => isVisible(store, r.id))).toBe(true);
  });

  it("is a safe no-op with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(() => commands.hideAllArtworkAbove(store)).not.toThrow();
    expect(store.canUndo).toBe(false);
  });
});
