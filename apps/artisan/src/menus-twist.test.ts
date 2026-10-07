// ─────────────────────────────────────────────────────────────
// menus-twist.test — Effect ▸ Distort & Transform ▸ Twist (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the Twist item exists, gates on a selection, and running it whirls the
// selection (rim pinned, interior spun) in one undoable step.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
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
  const p = makePath(
    { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 }), anchor({ x: 75, y: 75 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const interior = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors[4].point;

describe("menus — Effect ▸ Twist", () => {
  it("exposes the Twist item, enabled with a selection", () => {
    const { store } = setup();
    const it = itemById(store, "fx-twist");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Twist");
    expect(it!.disabled).toBeFalsy();
  });

  it("disables Twist with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "fx-twist")!.disabled).toBe(true);
  });

  it("running Twist spins the interior point (radius kept) but pins the rim, undoable", () => {
    const { store, p } = setup();
    itemById(store, "fx-twist")!.action!(); // default 30°
    const moved = interior(store, p.id);
    expect(moved).not.toEqual({ x: 75, y: 75 }); // interior rotated…
    expect(Math.hypot(moved.x - 50, moved.y - 50)).toBeCloseTo(Math.hypot(25, 25), 6); // …keeping its radius
    expect((Query.getItem(store.getState().doc, p.id) as PathItem).geometry.anchors[0].point).toEqual({ x: 0, y: 0 }); // rim corner pinned

    store.undo();
    expect(interior(store, p.id)).toEqual({ x: 75, y: 75 }); // restored
  });
});
