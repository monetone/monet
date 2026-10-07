// ─────────────────────────────────────────────────────────────
// menus-blend-options.test — Object ▸ Blend ▸ Blend Options (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the Blend Options submenu (Smooth Color + Specified Steps presets) exists,
// gates on selectionHasBlend, and runs the command end-to-end (menu → command → op).

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
  commands.blend(store, { steps: 8 }); // blend (10 children) + select the group
  return { store, gid: store.getState().selection[0] };
};
const byId = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);
const childCount = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as GroupItem).children.length;

describe("menus — Object ▸ Blend ▸ Blend Options", () => {
  it("exposes the submenu and its Smooth Color + Specified Steps presets, enabled with a blend selected", () => {
    const { store } = setup();
    const parent = byId(store, "blend-options");
    expect(parent).toBeTruthy();
    expect(parent!.label).toBe("Blend Options");
    for (const [id, label] of [
      ["blend-smooth", "Smooth Color"],
      ["blend-steps-3", "Specified Steps: 3"],
      ["blend-steps-8", "Specified Steps: 8"],
      ["blend-steps-16", "Specified Steps: 16"],
    ] as const) {
      const it = byId(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables the presets when the selection contains no blend", () => {
    const { store } = setup();
    store.clearSelection();
    expect(byId(store, "blend-smooth")!.disabled).toBe(true);
    expect(byId(store, "blend-steps-16")!.disabled).toBe(true);
  });

  it("runs Specified Steps: 16 menu → command → op, re-spacing the blend", () => {
    const { store, gid } = setup();
    expect(childCount(store, gid)).toBe(10); // 2 keys + 8 steps
    byId(store, "blend-steps-16")!.action!();
    expect(childCount(store, gid)).toBe(18); // 2 + 16
  });

  it("runs Smooth Color menu → command → op, re-spacing from the key colours", () => {
    const { store, gid } = setup();
    byId(store, "blend-smooth")!.action!();
    expect(childCount(store, gid)).toBe(222); // RED↔BLUE max channel diff 220 ⇒ 220 steps
  });
});
