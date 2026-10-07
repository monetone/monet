// ─────────────────────────────────────────────────────────────
// menus-save-selection.test — Select ▸ Save Selection (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the Save Selection item gates on a selection; after saving, a named
// item appears at the bottom of the Select menu and re-applies the selection.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };

const walk = (entries: Entry[], pred: (e: Entry) => boolean): Entry | null => {
  for (const e of entries) {
    if (pred(e)) return e;
    if (e.items) {
      const f = walk(e.items as Entry[], pred);
      if (f) return f;
    }
  }
  return null;
};
const byId = (store: ArtisanStore, id: string) => walk(buildMenus(store, store.getState()) as unknown as Entry[], (e) => e.id === id);
const byLabel = (store: ArtisanStore, label: string) => walk(buildMenus(store, store.getState()) as unknown as Entry[], (e) => e.label === label);

const rect = (x: number) => makeRect(x, 0, 40, 40, 0, 0, { fill: solid(rgba(200, 100, 100)) });
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const [a, b] = [rect(0), rect(50)];
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  return { store, a, b };
};

describe("menus — Select ▸ Save Selection", () => {
  it("disables Save Selection with an empty selection, enables it with one", () => {
    const { store, a } = setup();
    expect(byId(store, "save-selection")!.disabled).toBe(true);
    store.setSelection([a.id]);
    expect(byId(store, "save-selection")!.disabled).toBeFalsy();
  });

  it("after saving, a named item appears and re-applies the selection", () => {
    const { store, a, b } = setup();
    store.setSelection([a.id, b.id]);
    byId(store, "save-selection")!.action!(); // → "Selection 1"
    const saved = byLabel(store, "Selection 1");
    expect(saved).toBeTruthy();

    store.clearSelection();
    saved!.action!();
    expect(store.getState().selection.slice().sort()).toEqual([a.id, b.id].sort());
  });
});
