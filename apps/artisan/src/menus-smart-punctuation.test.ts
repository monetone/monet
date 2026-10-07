// ─────────────────────────────────────────────────────────────
// menus-smart-punctuation.test — Smart Punctuation menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Type ▸ Smart Punctuation exists, gates on a TEXT selection, and its
// action rewrites the text (menu → command → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeText, makeRect, Query, solid, rgba } from "./engine";
import type { TextItem } from "./engine";
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
  const t = makeText("it's a 'test'", 0, 0);
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([t.id]);
  return { store, t };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "smart-punctuation");

describe("menus — Smart Punctuation", () => {
  it("exposes Type ▸ Smart Punctuation, enabled with text selected", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Smart Punctuation");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled when the selection has no text", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    expect(item(store)!.disabled).toBe(true);
  });

  it("running the action curls the selected text", () => {
    const { store, t } = setup();
    item(store)!.action!();
    expect((Query.getItem(store.getState().doc, t.id) as TextItem).text).toBe("it’s a ‘test’");
  });
});
