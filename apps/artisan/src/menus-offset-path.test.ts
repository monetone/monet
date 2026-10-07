// ─────────────────────────────────────────────────────────────
// menus-offset-path.test — Offset Path menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: the Object ▸ Path ▸ Offset Path menu entry exists, is enabled with a
// selection, and its action actually runs the command against a real store —
// the full menu → command → op → document path, headless.

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { label?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[]; separator?: boolean };

const find = (entries: Entry[], label: string): Entry | null => {
  for (const e of entries) {
    if (e.label === label && typeof e.action === "function") return e;
    if (e.items) {
      const f = find(e.items as Entry[], label);
      if (f) return f;
    }
  }
  return null;
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(100, 100, 80, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};

describe("menus — Offset Path", () => {
  it("exposes Object ▸ Path ▸ Offset Path, enabled when something is selected", () => {
    const { store } = setup();
    const item = find(buildMenus(store, store.getState()) as unknown as Entry[], "Offset Path");
    expect(item).toBeTruthy();
    expect(item!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    const item = find(buildMenus(store, store.getState()) as unknown as Entry[], "Offset Path");
    expect(item!.disabled).toBe(true);
  });

  it("running the menu action creates the offset path on the document", () => {
    const { store, r } = setup();
    const item = find(buildMenus(store, store.getState()) as unknown as Entry[], "Offset Path");
    item!.action!(); // invoke exactly what the menu click does

    expect(store.getState().doc.layers[0].items).toHaveLength(2); // original + offset
    const sel = store.getState().selection;
    expect(sel).toHaveLength(1);
    expect(sel[0]).not.toBe(r.id); // the new offset path is selected
  });
});
