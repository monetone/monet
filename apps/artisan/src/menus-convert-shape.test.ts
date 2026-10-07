// ─────────────────────────────────────────────────────────────
// menus-convert-shape.test — Convert to Shape menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Convert to Shape ▸ {Rectangle, Rounded Rectangle, Ellipse}
// exist, gate on a selection, and their actions convert the selection.

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
  const r = makeRect(0, 0, 100, 80, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Convert to Shape", () => {
  it("exposes Rectangle / Rounded Rectangle / Ellipse, enabled with a selection", () => {
    const { store } = setup();
    for (const [id, label] of [["to-rect", "Rectangle"], ["to-round-rect", "Rounded Rectangle"], ["to-ellipse", "Ellipse"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables the items with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "to-ellipse")!.disabled).toBe(true);
  });

  it("running Ellipse converts the selected shape", () => {
    const { store, r } = setup();
    itemById(store, "to-ellipse")!.action!();
    expect(Query.getItem(store.getState().doc, r.id)).toBeNull();
    const it = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    expect(it.type).toBe("ellipse");
  });
});

describe("menus — Effect ▸ Convert to Shape", () => {
  it("exposes the Effect-menu trio (Illustrator's Effect ▸ Convert to Shape), gated on a selection", () => {
    const { store } = setup();
    for (const [id, label] of [["fx-to-rect", "Rectangle"], ["fx-to-round-rect", "Rounded Rectangle"], ["fx-to-ellipse", "Ellipse"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
    store.clearSelection();
    expect(itemById(store, "fx-to-ellipse")!.disabled).toBe(true);
  });

  it("runs the same op as the Object entry, converting the shape", () => {
    const { store, r } = setup();
    itemById(store, "fx-to-ellipse")!.action!();
    expect(Query.getItem(store.getState().doc, r.id)).toBeNull();
    expect(Query.getItem(store.getState().doc, store.getState().selection[0])!.type).toBe("ellipse");
  });
});
