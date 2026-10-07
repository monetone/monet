// ─────────────────────────────────────────────────────────────
// menus-artboard-crud.test — Object ▸ Artboards ▸ New / Delete Artboard (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: both items exist, Delete gates on the artboard count, and running them
// changes the document's artboard set (menu → command → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument } from "./engine";
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
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};
const item = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Object ▸ Artboards ▸ New / Delete Artboard", () => {
  it("exposes New Artboard (always) and Delete Artboard (disabled with one artboard)", () => {
    const store = setup();
    expect(item(store, "ab-new")!.label).toBe("New Artboard");
    expect(item(store, "ab-new")!.disabled).toBeFalsy();
    expect(item(store, "ab-delete")!.label).toBe("Delete Artboard");
    expect(item(store, "ab-delete")!.disabled).toBe(true); // only one artboard
  });

  it("enables Delete once there are two or more artboards", () => {
    const store = setup();
    item(store, "ab-new")!.action!(); // now 2 artboards
    expect(store.getState().doc.artboards.length).toBe(2);
    expect(item(store, "ab-delete")!.disabled).toBeFalsy();
  });

  it("runs New then Delete through the menu, round-tripping the count", () => {
    const store = setup();
    item(store, "ab-new")!.action!();
    expect(store.getState().doc.artboards.length).toBe(2);
    item(store, "ab-delete")!.action!();
    expect(store.getState().doc.artboards.length).toBe(1);
  });

  it("exposes Duplicate Artboard (always enabled) and it adds an artboard", () => {
    const store = setup();
    expect(item(store, "ab-duplicate")!.label).toBe("Duplicate Artboard");
    expect(item(store, "ab-duplicate")!.disabled).toBeFalsy();
    item(store, "ab-duplicate")!.action!();
    expect(store.getState().doc.artboards.length).toBe(2);
  });
});
