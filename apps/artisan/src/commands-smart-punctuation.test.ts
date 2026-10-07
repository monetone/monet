// ─────────────────────────────────────────────────────────────
// commands-smart-punctuation.test — Smart Punctuation command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Type ▸ Smart Punctuation rewrites the selected text in one
// undoable transaction and is a no-op on non-text selections.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeText, makeRect, Query, solid, rgba } from "./engine";
import type { TextItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const t = makeText('say "hi"', 0, 0);
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([t.id]);
  return { store, t };
};
const textOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as TextItem).text;

describe("commands.smartPunctuation", () => {
  it("curls the selected text's quotes, undoable", () => {
    const { store, t } = setup();
    commands.smartPunctuation(store);
    expect(textOf(store, t.id)).toBe("say “hi”");

    store.undo();
    expect(textOf(store, t.id)).toBe('say "hi"'); // restored in one transaction
  });

  it("is a no-op (no transaction) when the selection has no text", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    const before = store.canUndo;
    commands.smartPunctuation(store);
    expect(store.canUndo).toBe(before);
  });
});
