// ─────────────────────────────────────────────────────────────
// menus-lock-above.test — Object ▸ Lock All Artwork Above (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the menu item exists, gates on a selection, and running it locks every
// object above the selection (menu → command → op → document, undoable).

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
const isLocked = (store: ArtisanStore, id: string) => !!Query.getItem(store.getState().doc, id)!.locked;

describe("menus — Object ▸ Lock All Artwork Above", () => {
  it("exposes the item, enabled with a selection", () => {
    const { store } = setup();
    const it = itemById(store, "lockabove");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Lock All Artwork Above");
    expect(it!.disabled).toBeFalsy();
  });

  it("disables it with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "lockabove")!.disabled).toBe(true);
  });

  it("running it locks the objects above the selection, undoably", () => {
    const { store, rects } = setup();
    const [a, b, c, d] = rects;
    itemById(store, "lockabove")!.action!();
    expect(isLocked(store, c.id)).toBe(true); // above b
    expect(isLocked(store, d.id)).toBe(true);
    expect(isLocked(store, a.id)).toBe(false); // below
    expect(isLocked(store, b.id)).toBe(false); // the selection itself

    store.undo();
    expect(isLocked(store, c.id)).toBe(false); // restored
  });

  it("keeps the selection (unlike Lock Selection) and adds no undo entry when nothing is above", () => {
    const { store, rects } = setup();
    const top = rects[3];
    store.setSelection([top.id]); // already the front-most → nothing above
    const undoBefore = store.canUndo;
    commands.lockAllArtworkAbove(store);
    expect(store.getState().selection).toEqual([top.id]); // selection preserved
    expect(store.canUndo).toBe(undoBefore); // Immer no-op ⇒ no spurious undo step
    expect(rects.every((r) => !isLocked(store, r.id))).toBe(true);
  });

  it("is a safe no-op with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(() => commands.lockAllArtworkAbove(store)).not.toThrow();
    expect(store.canUndo).toBe(false);
  });
});
