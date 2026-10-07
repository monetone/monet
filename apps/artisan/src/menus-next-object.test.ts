// ─────────────────────────────────────────────────────────────
// menus-next-object.test — Select ▸ Next Object Above / Below (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the two Select-menu items exist, are enabled only with EXACTLY one
// object selected, and their actions move the selection to the adjacent sibling
// in paint order (menu → command → Query.nextObject → store selection).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect } from "./engine";
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

// a (back) · b (middle) · c (front).
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 10, 10);
  const b = makeRect(0, 0, 10, 10);
  const c = makeRect(0, 0, 10, 10);
  for (const r of [a, b, c]) doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([b.id]);
  return { store, a, b, c };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Select ▸ Next Object Above / Below", () => {
  it("exposes both items, enabled with exactly one object selected", () => {
    const { store } = setup();
    for (const [id, label] of [["next-above", "Next Object Above"], ["next-below", "Next Object Below"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables both with zero or multiple objects selected", () => {
    const { store, a, b } = setup();
    store.clearSelection();
    expect(itemById(store, "next-above")!.disabled).toBe(true);
    store.setSelection([a.id, b.id]);
    expect(itemById(store, "next-above")!.disabled).toBe(true);
  });

  it("running Next Object Above / Below moves the selection — without an undo entry", () => {
    const { store, a, b, c } = setup();
    itemById(store, "next-above")!.action!();
    expect(store.getState().selection).toEqual([c.id]); // b → c (front)
    expect(store.canUndo).toBe(false); // selection-only: no undo entry
    expect(store.getState().dirty).toBe(false); // and not a document edit

    store.setSelection([b.id]);
    itemById(store, "next-below")!.action!();
    expect(store.getState().selection).toEqual([a.id]); // b → a (back)
    expect(store.canUndo).toBe(false);
  });

  it("the command is a no-op for zero / multiple selection and at the boundary", () => {
    const { store, a, b, c } = setup();
    store.setSelection([a.id, b.id]); // multiple → no-op
    commands.selectNextObject(store, "above");
    expect(store.getState().selection).toEqual([a.id, b.id]);

    store.clearSelection(); // none → no-op (no throw, no empty setSelection)
    commands.selectNextObject(store, "above");
    expect(store.getState().selection).toEqual([]);

    store.setSelection([c.id]); // front-most, "above" → no sibling → selection unchanged
    commands.selectNextObject(store, "above");
    expect(store.getState().selection).toEqual([c.id]);
  });
});
