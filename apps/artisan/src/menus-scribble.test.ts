// ─────────────────────────────────────────────────────────────
// menus-scribble.test — Effect ▸ Stylize ▸ Scribble (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the Scribble item exists, gates on a selection, and running it turns a
// filled shape into an open scribble path stroked in its former fill colour
// (menu → command → op → document, undoable).

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
    { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const item = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id) as unknown as PathItem;

describe("menus — Effect ▸ Scribble", () => {
  it("exposes the Scribble item, enabled with a selection", () => {
    const { store } = setup();
    const it = itemById(store, "scribble");
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Scribble");
    expect(it!.disabled).toBeFalsy();
  });

  it("disables Scribble with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "scribble")!.disabled).toBe(true);
  });

  it("running Scribble turns the filled shape into an open stroked scribble, undoably", () => {
    const { store, p } = setup();
    itemById(store, "scribble")!.action!();
    const it = item(store, p.id);
    expect(it.geometry.closed).toBe(false); // an open scribble line
    expect(it.geometry.anchors.length).toBeGreaterThan(2);
    expect(it.fill.type).toBe("none"); // fill replaced
    expect(it.stroke.paint.type === "solid" ? it.stroke.paint.color : null).toEqual({ r: 220, g: 0, b: 0, a: 1 });
    expect(store.getState().selection).toEqual([p.id]); // selection preserved (id kept)

    store.undo();
    expect(item(store, p.id).geometry.closed).toBe(true); // restored to the filled square
  });
});
