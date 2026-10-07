// ─────────────────────────────────────────────────────────────
// menus-convert-text.test — Type ▸ Convert to Area / Point Type (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the two Type-menu items exist, gate on point vs area text, and run the
// command end-to-end (menu → command → op → document), round-tripping the kind.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeText, Query } from "./engine";
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
  const doc = makeDocument();
  const t = makeText("Hello", 0, 0); // point text
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([t.id]);
  return { store, id: t.id };
};
const item = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const box = (store: ArtisanStore, id: string) => {
  const it = Query.getItem(store.getState().doc, id) as { boxWidth?: number; boxHeight?: number };
  return { w: it.boxWidth, h: it.boxHeight };
};

describe("menus — Type ▸ Convert to Area/Point Type", () => {
  it("exposes both items; gating reflects the selected text kind", () => {
    const { store } = setup(); // point text selected
    expect(item(store, "to-area-type")!.label).toBe("Convert to Area Type");
    expect(item(store, "to-point-type")!.label).toBe("Convert to Point Type");
    expect(item(store, "to-area-type")!.disabled).toBeFalsy(); // point → can convert to area
    expect(item(store, "to-point-type")!.disabled).toBe(true); // not area yet
  });

  it("converts point → area → point through the menu, undoably", () => {
    const { store, id } = setup();
    item(store, "to-area-type")!.action!();
    expect(box(store, id).w).toBeGreaterThan(0); // boxed (area)
    // gating flips: now area text, so Convert to Point is enabled
    expect(item(store, "to-point-type")!.disabled).toBeFalsy();
    expect(item(store, "to-area-type")!.disabled).toBe(true);

    item(store, "to-point-type")!.action!();
    expect(box(store, id).w).toBeUndefined(); // back to point

    store.undo();
    expect(box(store, id).w).toBeGreaterThan(0); // undo restores the area box
  });

  it("disables both when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store, "to-area-type")!.disabled).toBe(true);
    expect(item(store, "to-point-type")!.disabled).toBe(true);
  });
});
