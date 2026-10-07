// ─────────────────────────────────────────────────────────────
// menus-transform-again.test — Object ▸ Transform ▸ Transform Again (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the item exists, gates on (selection AND a recorded last transform),
// and runs the command end-to-end.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";
import { commands } from "./commands";
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
  const p = makePath({
    closed: true,
    anchors: [anchor({ x: 100, y: 100 }), anchor({ x: 220, y: 100 }), anchor({ x: 220, y: 160 }), anchor({ x: 100, y: 160 })],
  });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const item = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const bounds = (store: ArtisanStore, id: string) => Query.selectionBounds(store.getState().doc, [id])!;

describe("menus — Object ▸ Transform ▸ Transform Again", () => {
  it("exists but is disabled until a transform has been run", () => {
    const { store } = setup();
    expect(item(store, "transform-again")!.label).toBe("Transform Again");
    expect(item(store, "transform-again")!.disabled).toBe(true); // nothing recorded yet
  });

  it("enables after a transform, and disables again when the selection is cleared", () => {
    const { store } = setup();
    commands.rotate90CW(store);
    expect(item(store, "transform-again")!.disabled).toBeFalsy(); // selection + recorded op
    store.clearSelection();
    expect(item(store, "transform-again")!.disabled).toBe(true); // needs a selection too
  });

  it("runs menu → command, repeating the recorded transform", () => {
    const { store, p } = setup();
    commands.rotate90CW(store); // bounds 120×60 → 60×120
    expect(bounds(store, p.id).width).toBeCloseTo(60, 6);
    item(store, "transform-again")!.action!(); // → 180° total
    expect(bounds(store, p.id).width).toBeCloseTo(120, 6);
  });
});
