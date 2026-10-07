// Envelope creation must run through the real Immer-backed command transaction.

import { describe, expect, it } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, Query, makeDocument, makeRect } from "./engine";
import { buildMenus } from "./ui/menus";

type Entry = { id?: string; disabled?: boolean; items?: Entry[] };
const menuItem = (entries: Entry[], id: string): Entry | undefined => {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    const nested = menuItem(entry.items ?? [], id);
    if (nested) return nested;
  }
};

const storeWith = (...items: ReturnType<typeof makeRect>[]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.layers[0].items.push(...items);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection(items.map((item) => item.id));
  return store;
};

describe("commands — Envelope Distort", () => {
  it("creates a warp envelope inside an Immer transaction", () => {
    const store = storeWith(makeRect(0, 0, 100, 80));

    expect(() => commands.makeEnvelopeWarp(store, "arc", 0.4)).not.toThrow();

    const selected = Query.getItem(store.getState().doc, store.getState().selection[0]);
    expect(selected?.type === "group" && selected.envelope?.kind).toBe("warp");
    expect(store.transactionBase).toBeNull();
    expect(menuItem(buildMenus(store, store.getState()) as unknown as Entry[], "ungroup")?.disabled).toBe(true);
  });

  it("creates a top-object envelope inside an Immer transaction", () => {
    const store = storeWith(makeRect(0, 0, 100, 80), makeRect(0, 0, 100, 80));

    expect(() => commands.makeEnvelopeTopObject(store)).not.toThrow();

    const selected = Query.getItem(store.getState().doc, store.getState().selection[0]);
    expect(selected?.type === "group" && selected.envelope?.kind).toBe("top-object");
    expect(store.transactionBase).toBeNull();
  });
});
