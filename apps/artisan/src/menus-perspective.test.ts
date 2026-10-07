// ─────────────────────────────────────────────────────────────
// menus-perspective.test — Object ▸ Perspective command wiring
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { MenuItemDef } from "@monet-ui/monet-react";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, Query, makeDocument, makeRect } from "./engine";

type Entry = { id?: string; label?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };

const findById = (entries: Entry[], id: string): Entry | null => {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    if (entry.items) {
      const found = findById(entry.items as Entry[], id);
      if (found) return found;
    }
  }
  return null;
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const rect = makeRect(0, 0, 100, 100);
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, rect };
};

const menuItem = (store: ArtisanStore, id: string) =>
  findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Perspective", () => {
  it("exposes Make/Expand/Release with correct initial gating", () => {
    const { store } = setup();

    expect(menuItem(store, "perspective-make")).toMatchObject({ label: "Make", disabled: false });
    expect(menuItem(store, "perspective-expand")).toMatchObject({ label: "Expand", disabled: true });
    expect(menuItem(store, "perspective-release")).toMatchObject({ label: "Release", disabled: true });
  });

  it("runs Make and then enables Expand/Release for the selected Perspective group", () => {
    const { store } = setup();

    menuItem(store, "perspective-make")!.action!();

    const [id] = store.getState().selection;
    expect(Query.getItem(store.doc, id)?.type).toBe("group");
    expect(Query.perspectiveEntries(store.doc)).toHaveLength(1);
    expect(menuItem(store, "perspective-expand")!.disabled).toBe(false);
    expect(menuItem(store, "perspective-release")!.disabled).toBe(false);
  });
});
