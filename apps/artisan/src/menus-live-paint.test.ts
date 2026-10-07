// ─────────────────────────────────────────────────────────────
// menus-live-paint.test — Object ▸ Live Paint command wiring
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
  const a = makeRect(0, 0, 40, 40);
  const b = makeRect(30, 0, 40, 40);
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  return { store, a, b };
};

const menuItem = (store: ArtisanStore, id: string) =>
  findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Live Paint", () => {
  it("exposes Make/Expand/Release with correct initial gating", () => {
    const { store } = setup();

    expect(menuItem(store, "live-paint-make")).toMatchObject({ label: "Make", disabled: false });
    expect(menuItem(store, "live-paint-expand")).toMatchObject({ label: "Expand", disabled: true });
    expect(menuItem(store, "live-paint-release")).toMatchObject({ label: "Release", disabled: true });
  });

  it("runs Make and then enables Expand/Release for the selected Live Paint group", () => {
    const { store } = setup();

    menuItem(store, "live-paint-make")!.action!();

    const [id] = store.getState().selection;
    expect(Query.getItem(store.doc, id)?.type).toBe("group");
    expect(Query.livePaintEntries(store.doc)).toHaveLength(1);
    expect(menuItem(store, "live-paint-expand")!.disabled).toBe(false);
    expect(menuItem(store, "live-paint-release")!.disabled).toBe(false);
  });
});
