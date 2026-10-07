// ─────────────────────────────────────────────────────────────
// menus-blend.test — Blend menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Blend ▸ Make exists, gates on a ≥2 selection, and its action
// runs the command end-to-end (menu → command → op → document), headless.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
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
  const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(200, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id, b.id]);
  return { store, a, b };
};

const makeBlendItem = (store: ArtisanStore) =>
  findById(buildMenus(store, store.getState()) as unknown as Entry[], "make-blend");
const releaseBlendItem = (store: ArtisanStore) =>
  findById(buildMenus(store, store.getState()) as unknown as Entry[], "release-blend");

describe("menus — Blend", () => {
  it("exposes Object ▸ Blend ▸ Make, enabled with two objects selected", () => {
    const { store } = setup();
    const item = makeBlendItem(store);
    expect(item).toBeTruthy();
    expect(item!.label).toBe("Make");
    expect(item!.disabled).toBeFalsy();
  });

  it("is disabled with fewer than two objects", () => {
    const { store, a } = setup();
    store.setSelection([a.id]);
    expect(makeBlendItem(store)!.disabled).toBe(true);
  });

  it("running the action creates the Blend group on the document", () => {
    const { store } = setup();
    makeBlendItem(store)!.action!();
    const sel = store.getState().selection;
    expect(sel).toHaveLength(1);
    const g = store.getState().doc.layers[0].items[0];
    expect(g.id).toBe(sel[0]);
    expect(g.type).toBe("group");
    expect(g.name).toBe("Blend");
  });
});

describe("menus — Blend ▸ Release", () => {
  it("exposes Release after Make, disabled until a blend is selected", () => {
    const { store } = setup();
    const item = releaseBlendItem(store);
    expect(item).toBeTruthy();
    expect(item!.label).toBe("Release");
    expect(item!.disabled).toBe(true); // two plain rects selected → no blend yet
    // ordering: make-blend, release-blend, reverse-blend, then the Blend Options submenu
    const blend = findById(buildMenus(store, store.getState()) as unknown as Entry[], "blend")!;
    const ids = (blend.items as Entry[]).map((i) => i.id);
    expect(ids).toEqual(["make-blend", "release-blend", "reverse-blend", "blend-options"]);
  });

  it("is enabled once a blend group is selected", () => {
    const { store } = setup();
    makeBlendItem(store)!.action!(); // make → selects the blend group
    expect(releaseBlendItem(store)!.disabled).toBeFalsy();
  });

  it("running Release restores the two originals and removes the blend group, undoably", () => {
    const { store } = setup();
    makeBlendItem(store)!.action!();
    expect(store.getState().doc.layers[0].items).toHaveLength(1); // the blend group

    releaseBlendItem(store)!.action!();
    const items = store.getState().doc.layers[0].items;
    expect(items.every((i) => i.type !== "group")).toBe(true); // group gone
    expect(items).toHaveLength(2); // the two original key objects restored
    expect([...store.getState().selection].sort()).toEqual(items.map((i) => i.id).sort());

    store.undo();
    expect(store.getState().doc.layers[0].items).toHaveLength(1); // blend group back
    expect(store.getState().doc.layers[0].items[0].type).toBe("group");
  });

  it("is a safe no-op when the selection is not a blend", () => {
    const { store } = setup(); // two plain rects
    const before = store.canUndo;
    commands.releaseBlend(store);
    expect(store.canUndo).toBe(before); // nothing released → no undo step
    expect(store.getState().doc.layers[0].items).toHaveLength(2);
  });
});
