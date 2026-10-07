// ─────────────────────────────────────────────────────────────
// menus-bounding-box.test — View ▸ Show Bounding Box (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the item exists with the ⇧⌘B shortcut, its checkmark mirrors the
// showBoundingBox flag, and running it toggles the flag.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument } from "./engine";
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

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "bounding-box");

describe("menus — View ▸ Show Bounding Box", () => {
  it("exposes the item with the ⇧⌘B shortcut, checked by default", () => {
    const store = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Show Bounding Box");
    expect(it!.shortcut).toBe("⇧⌘B");
    expect(it!.checked).toBe(true);
  });

  it("the checkmark follows the flag, and the action toggles it", () => {
    const store = setup();
    item(store)!.action!();
    expect(store.getState().showBoundingBox).toBe(false);
    expect(item(store)!.checked).toBe(false); // rebuilt menu reflects new state
  });
});
