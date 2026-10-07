// ─────────────────────────────────────────────────────────────
// menus-distribute.test — Object ▸ Distribute menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Distribute ▸ {Horizontal Distribute Left/Center/Right,
// Vertical Distribute Top/Center/Bottom, Distribute Horizontal/Vertical Space}
// exist, gate on a 3+ selection, and run the matching op (menu → command → op →
// document, undoable).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, Query } from "./engine";
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

// a[0,20] c=10 · b[40,60] c=50 · c[100,180] c=140 (c is wide).
const setup = (count = 3) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const rects = [
    makeRect(0, 0, 20, 20),
    makeRect(40, 0, 20, 20),
    makeRect(100, 0, 80, 20),
  ].slice(0, count);
  for (const r of rects) doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection(rects.map((r) => r.id));
  return { store, rects };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const cx = (store: ArtisanStore, id: string) => {
  const b = Query.worldBounds(store.getState().doc, id)!;
  return b.x + b.width / 2;
};

describe("menus — Object ▸ Distribute", () => {
  it("exposes the eight distribute items, enabled with a 3+ selection", () => {
    const { store } = setup();
    for (const [id, label] of [
      ["dist-left", "Horizontal Distribute Left"],
      ["dist-center-h", "Horizontal Distribute Center"],
      ["dist-right", "Horizontal Distribute Right"],
      ["dist-top", "Vertical Distribute Top"],
      ["dist-center-v", "Vertical Distribute Center"],
      ["dist-bottom", "Vertical Distribute Bottom"],
      ["dist-h", "Distribute Horizontal Space"],
      ["dist-v", "Distribute Vertical Space"],
    ] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables distribute with fewer than three objects", () => {
    const { store } = setup(2);
    expect(itemById(store, "dist-center-h")!.disabled).toBe(true);
  });

  it("running Horizontal Distribute Center evens the centres, undoable", () => {
    const { store, rects } = setup();
    const [a, b, c] = rects;
    itemById(store, "dist-center-h")!.action!();
    expect(cx(store, a.id)).toBeCloseTo(10, 3); // extreme pinned
    expect(cx(store, c.id)).toBeCloseTo(140, 3); // extreme pinned
    expect(cx(store, b.id)).toBeCloseTo(75, 3); // evenly spaced (≠ spacing's 60)

    store.undo();
    expect(cx(store, b.id)).toBeCloseTo(50, 3); // restored to original centre
  });

  it("running Horizontal Distribute Left evens the LEFT edges", () => {
    const { store, rects } = setup();
    const [a, b, c] = rects; // lefts: a 0 · b 40 · c 100 ⇒ b.left → 50
    const lx = (id: string) => Query.worldBounds(store.getState().doc, id)!.x;
    itemById(store, "dist-left")!.action!();
    expect(lx(a.id)).toBeCloseTo(0, 3);
    expect(lx(c.id)).toBeCloseTo(100, 3);
    expect(lx(b.id)).toBeCloseTo(50, 3); // evened left edge (centre would give 65)
  });
});
