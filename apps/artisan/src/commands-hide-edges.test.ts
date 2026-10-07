// ─────────────────────────────────────────────────────────────
// commands-hide-edges.test — View ▸ Hide Edges (⌘H)
// ─────────────────────────────────────────────────────────────
// Hide Edges toggles the selection chrome (outline + handles) off without
// deselecting. It is a VIEW flag (store.set), not a document edit, so it never
// creates an undo entry. The menu item's checkmark mirrors the flag.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; shortcut?: string; checked?: boolean; action?: () => void; items?: MenuItemDef[] };
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
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("commands.toggleHideEdges", () => {
  it("flips hideEdges and never adds an undo entry (it is a view flag)", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    expect(store.getState().hideEdges).toBe(false); // default: edges shown
    const undos = store.canUndo;
    commands.toggleHideEdges(store);
    expect(store.getState().hideEdges).toBe(true);
    commands.toggleHideEdges(store);
    expect(store.getState().hideEdges).toBe(false);
    expect(store.canUndo).toBe(undos); // a view toggle, not a document mutation
  });

  it("hides edges WITHOUT clearing the selection", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0, 1)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    commands.toggleHideEdges(store);
    expect(store.getState().selection).toEqual([r.id]); // still selected, just no chrome
  });
});

describe("menus — View ▸ Hide Edges", () => {
  it("exposes the item with ⌘H and a checkmark that mirrors the flag", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    let item = itemById(store, "hide-edges");
    expect(item?.label).toBe("Hide Edges");
    expect(item?.shortcut).toBe("⌘H");
    expect(item?.checked).toBeFalsy();

    item!.action!(); // toggle it on
    expect(store.getState().hideEdges).toBe(true);
    item = itemById(store, "hide-edges");
    expect(item?.checked).toBe(true); // re-built menu reflects the new state
  });
});
