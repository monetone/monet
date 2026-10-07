// ─────────────────────────────────────────────────────────────
// menus-warp.test — Effect ▸ Warp menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Effect ▸ Warp ▸ {Arc, Arc Lower, Arc Upper} exist, gate on a selection,
// and their actions bend it (menu → command → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";
import type { PathItem } from "./engine";

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

const diamond = () => ({
  closed: true,
  anchors: [anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 50 }), anchor({ x: 50, y: 100 }), anchor({ x: 0, y: 50 })],
});
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath(diamond());
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Effect ▸ Warp", () => {
  it("exposes Arc / Arc Lower / Arc Upper / Flag / Wave / Bulge / Rise, enabled with a selection", () => {
    const { store } = setup();
    for (const [id, label] of [["warp-arc", "Arc"], ["warp-arc-lower", "Arc Lower"], ["warp-arc-upper", "Arc Upper"], ["warp-flag", "Flag"], ["warp-wave", "Wave"], ["warp-bulge", "Bulge"], ["warp-rise", "Rise"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables Arc with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "warp-arc")!.disabled).toBe(true);
  });

  it("running Arc bends the selected path", () => {
    const { store, p } = setup();
    itemById(store, "warp-arc")!.action!();
    const top = (Query.getItem(store.getState().doc, p.id) as PathItem).geometry.anchors[0].point;
    expect(top).toEqual({ x: 50, y: 25 });
  });

  it("running Bulge swells the selected path vertically", () => {
    const { store, p } = setup();
    itemById(store, "warp-bulge")!.action!();
    const top = (Query.getItem(store.getState().doc, p.id) as PathItem).geometry.anchors[0].point;
    expect(top).toEqual({ x: 50, y: -25 });
  });

  it("running Rise shears the diamond: left vertex pinned, right rises", () => {
    const { store, p } = setup();
    itemById(store, "warp-rise")!.action!();
    const a = (Query.getItem(store.getState().doc, p.id) as PathItem).geometry.anchors;
    expect(a[3].point).toEqual({ x: 0, y: 50 }); // left vertex (s=0) pinned
    expect(a[1].point).toEqual({ x: 100, y: 0 }); // right vertex (s=1) rises 50
  });
});
