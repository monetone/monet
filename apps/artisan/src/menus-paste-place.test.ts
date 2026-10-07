// ─────────────────────────────────────────────────────────────
// menus-paste-place.test — Edit ▸ Paste in Place / Paste on All Artboards (smoke)
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeArtboard, makeRect, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; shortcut?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };

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

const make = (artboards: number) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  for (let i = 1; i < artboards; i++) doc.artboards.push(makeArtboard(`Artboard ${i + 1}`, 1200 * i, 0, 1000, 1000));
  const r = makeRect(100, 100, 80, 80, 0, 0, { fill: solid(rgba(80, 140, 220)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Edit ▸ Paste in Place / Paste on All Artboards", () => {
  it("exposes both items with their Illustrator shortcuts", () => {
    const { store } = make(2);
    const place = itemById(store, "pasteplace");
    expect(place?.label).toBe("Paste in Place");
    expect(place?.shortcut).toBe("⌥⌘V");
    const all = itemById(store, "pasteall");
    expect(all?.label).toBe("Paste on All Artboards");
    expect(all?.shortcut).toBe("⌥⇧⌘V");
  });

  it("gates paste commands on clipboard content and Paste on All Artboards on ≥2 artboards", () => {
    const one = make(1).store;
    const two = make(2).store;
    for (const id of ["paste", "pastefront", "pasteback", "pasteplace", "pasteall"]) {
      expect(itemById(two, id)!.disabled).toBe(true);
    }

    itemById(two, "copy")!.action!();
    expect(itemById(one, "pasteall")!.disabled).toBe(true);
    expect(itemById(two, "pasteall")!.disabled).toBeFalsy();
    for (const id of ["paste", "pastefront", "pasteback", "pasteplace"]) {
      expect(itemById(two, id)!.disabled).toBeFalsy();
    }
  });

  it("running Paste in Place adds a copy to the document", () => {
    const { store } = make(2);
    // Copy first so the module clipboard holds this store's item.
    itemById(store, "copy")!.action!();
    const before = store.getState().doc.layers[0].items.length;
    itemById(store, "pasteplace")!.action!();
    expect(store.getState().doc.layers[0].items.length).toBe(before + 1);
  });
});
