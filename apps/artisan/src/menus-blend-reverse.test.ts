// ─────────────────────────────────────────────────────────────
// menus-blend-reverse.test — Object ▸ Blend ▸ Reverse Front to Back (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the item exists, gates on selectionHasBlend, and runs the command
// end-to-end (menu → command → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import { commands } from "./commands";
import type { MenuItemDef } from "@monet-ui/monet-react";
import type { GroupItem } from "./engine";

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

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const squareAt = (x: number, s = 20) => ({
  closed: true,
  anchors: [anchor({ x, y: 0 }), anchor({ x: x + s, y: 0 }), anchor({ x: x + s, y: s }), anchor({ x, y: s })],
});
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makePath(squareAt(0), { fill: solid(RED) });
  const b = makePath(squareAt(100), { fill: solid(BLUE) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  commands.blend(store, { steps: 2 }); // blend + select the group
  return { store, gid: store.getState().selection[0] };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "reverse-blend");
const childIds = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as GroupItem).children.map((c) => c.id);

describe("menus — Object ▸ Blend ▸ Reverse Front to Back", () => {
  it("exposes the item, enabled while a Blend group is selected", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Reverse Front to Back");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled when the selection contains no blend", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("runs menu → command → op, reversing the blend's child order", () => {
    const { store, gid } = setup();
    const before = childIds(store, gid);
    item(store)!.action!();
    expect(childIds(store, gid)).toEqual([...before].reverse());
  });
});
