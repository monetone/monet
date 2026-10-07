// ─────────────────────────────────────────────────────────────
// menus-change-case.test — Change Case menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Type ▸ Change Case ▸ {UPPERCASE, lowercase, Title Case, Sentence case}
// exist, gate on a TEXT selection, and their actions recase it.

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
  const t = makeText("hello world", 0, 0);
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([t.id]);
  return { store, t };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Change Case", () => {
  it("exposes the four case items, enabled when text is selected", () => {
    const { store } = setup();
    for (const [id, label] of [["case-upper", "UPPERCASE"], ["case-lower", "lowercase"], ["case-title", "Title Case"], ["case-sentence", "Sentence case"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables the items when the selection has no text", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    expect(itemById(store, "case-upper")!.disabled).toBe(true);
  });

  it("running Title Case recases the selected text", () => {
    const { store, t } = setup();
    itemById(store, "case-title")!.action!();
    expect((Query.getItem(store.getState().doc, t.id) as TextItem).text).toBe("Hello World");
  });
});
