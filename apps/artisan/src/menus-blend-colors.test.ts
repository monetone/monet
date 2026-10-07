// ─────────────────────────────────────────────────────────────
// menus-blend-colors.test — Blend Colors menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Edit ▸ Edit Colors ▸ Blend {Front to Back, Horizontally, Vertically}
// exist, gate on a ≥3 selection, and their actions blend the fills.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";
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
  const a = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 255, 0)) });
  const c = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  doc.layers[0].items.push(a, b, c);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id, c.id]);
  return { store, a, b, c };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Blend Colors", () => {
  it("exposes the three Blend items, enabled with ≥3 selected", () => {
    const { store } = setup();
    for (const [id, label] of [["blend-ftb", "Blend Front to Back"], ["blend-h", "Blend Horizontally"], ["blend-v", "Blend Vertically"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables the items below 3 selected", () => {
    const { store, a, b } = setup();
    store.setSelection([a.id, b.id]);
    expect(itemById(store, "blend-ftb")!.disabled).toBe(true);
  });

  it("running Blend Front to Back blends the middle object", () => {
    const { store, b } = setup();
    itemById(store, "blend-ftb")!.action!();
    const f = Query.getItem(store.getState().doc, b.id)!.fill;
    expect(f.type === "solid" ? f.color : null).toEqual({ r: 110, g: 0, b: 110, a: 1 });
  });
});
