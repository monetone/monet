// ─────────────────────────────────────────────────────────────
// menus-trim-view.test — View ▸ Trim View menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: View ▸ Trim View exists, its checkmark tracks state.trimView, and its
// action toggles the view flag.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; checked?: boolean; action?: () => void; items?: MenuItemDef[] };
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
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "trim-view");

describe("menus — View ▸ Trim View", () => {
  it("exposes the toggle, unchecked by default", () => {
    const store = new ArtisanStore();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Trim View");
    expect(it!.checked).toBe(false);
  });

  it("its action toggles trimView and the checkmark tracks state", () => {
    const store = new ArtisanStore();
    item(store)!.action!();
    expect(store.getState().trimView).toBe(true);
    expect(item(store)!.checked).toBe(true); // a freshly built menu reflects the new state
  });
});
