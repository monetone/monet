// ─────────────────────────────────────────────────────────────
// commands-change-case.test — Change Case command (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Type ▸ Change Case recases the selected text in one undoable
// transaction and is a no-op on non-text selections.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeText, makeRect, Query, solid, rgba } from "./engine";
import type { TextItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const t = makeText("Hello World", 0, 0);
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([t.id]);
  return { store, t };
};
const textOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as TextItem).text;

describe("commands.changeCase", () => {
  it("uppercases the selected text, undoable", () => {
    const { store, t } = setup();
    commands.changeCase(store, "upper");
    expect(textOf(store, t.id)).toBe("HELLO WORLD");

    store.undo();
    expect(textOf(store, t.id)).toBe("Hello World"); // restored in one transaction
  });

  it("is a no-op (no transaction) when the selection has no text", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    const before = store.canUndo;
    commands.changeCase(store, "upper");
    expect(store.canUndo).toBe(before);
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.changeCase(store, "lower");
    expect(store.canUndo).toBe(before);
  });
});
