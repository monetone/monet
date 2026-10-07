// ─────────────────────────────────────────────────────────────
// menus-convert-anchors.test — Object ▸ Path ▸ Convert to Corner / Smooth (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: both items exist, gate on the Direct-Selection anchor set, and run the
// command end-to-end (menu → command → op → document).

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

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({
    closed: true,
    anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 120, y: 0 }), anchor({ x: 120, y: 120 }), anchor({ x: 0, y: 120 })],
  });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  store.setAnchorSelection({ [p.id]: [0, 1, 2, 3] });
  return { store, p };
};
const item = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const smoothCount = (store: ArtisanStore, id: string) =>
  (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors.filter(
    (a) => a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y,
  ).length;

describe("menus — Object ▸ Path ▸ Convert to Corner / Smooth", () => {
  it("exposes both items, enabled with an anchor selection", () => {
    const { store } = setup();
    expect(item(store, "convert-corner")!.label).toBe("Convert to Corner");
    expect(item(store, "convert-smooth")!.label).toBe("Convert to Smooth");
    expect(item(store, "convert-corner")!.disabled).toBeFalsy();
    expect(item(store, "convert-smooth")!.disabled).toBeFalsy();
  });

  it("disables both when there is no anchor selection", () => {
    const { store } = setup();
    store.setAnchorSelection({});
    expect(item(store, "convert-corner")!.disabled).toBe(true);
    expect(item(store, "convert-smooth")!.disabled).toBe(true);
  });

  it("runs Smooth then Corner through the menu, round-tripping the handles", () => {
    const { store, p } = setup();
    item(store, "convert-smooth")!.action!();
    expect(smoothCount(store, p.id)).toBe(4); // all anchors smoothed
    item(store, "convert-corner")!.action!();
    expect(smoothCount(store, p.id)).toBe(0); // back to corners
  });
});
