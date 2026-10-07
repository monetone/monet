// ─────────────────────────────────────────────────────────────
// commands-copy-cut.test — Copy / Cut clipboard behavior (⌘C / ⌘X)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — Copy places a clone of the selection on the
// clipboard WITHOUT changing the document; Cut copies then deletes the
// selection; Paste reproduces the clipboard contents (re-cloned each time, so
// the clipboard is reusable and a deep copy). The Cut's delete is one undo step.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba, type Item } from "./engine";

const RED = () => solid(rgba(220, 0, 0));
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

const setup = (n = 1) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(50, 50, 40, 40, 0, 0, { fill: RED() });
  doc.layers[0].items.push(a);
  const ids = [a.id];
  if (n >= 2) {
    const b = makeRect(150, 50, 40, 40, 0, 0, { fill: RED() });
    doc.layers[0].items.push(b);
    ids.push(b.id);
  }
  store.replaceDoc(doc, { markClean: true });
  store.setSelection(ids);
  return { store, A: a.id, ids };
};

describe("Copy / Cut", () => {
  it("Copy is non-destructive; Paste adds a distinct clone", () => {
    const { store, A } = setup();
    commands.copy(store);
    expect(items(store)).toHaveLength(1); // doc unchanged by copy

    commands.paste(store);
    const list = items(store);
    expect(list).toHaveLength(2);
    const pasted = list.find((i) => i.id !== A)!;
    expect(pasted.id).not.toBe(A); // fresh id
    expect(pasted.type).toBe("rect");
  });

  it("Cut removes the original; Paste brings a clone back", () => {
    const { store, A } = setup();
    commands.cut(store);
    expect(items(store)).toHaveLength(0); // original removed

    commands.paste(store);
    const list = items(store);
    expect(list).toHaveLength(1);
    expect(list[0].id).not.toBe(A); // a clone, not the original id
    expect(list[0].type).toBe("rect");
  });

  it("Cut's delete is one undoable step", () => {
    const { store, A } = setup();
    commands.cut(store);
    expect(items(store)).toHaveLength(0);
    store.undo();
    const list = items(store);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(A); // original restored
  });

  it("the clipboard is reusable — Paste re-clones each time", () => {
    const { store, A } = setup();
    commands.copy(store);
    commands.paste(store);
    commands.paste(store);
    const ids = items(store).map((i) => i.id);
    expect(ids).toHaveLength(3); // original + 2 independent copies
    expect(new Set(ids).size).toBe(3); // all distinct
  });

  it("Copy deep-clones — editing a paste doesn't affect a later paste", () => {
    const { store, A } = setup(); // A is red
    commands.copy(store);
    commands.paste(store);
    const copy1 = items(store).find((i) => i.id !== A)!.id;
    // recolour the first paste to blue
    store.transact("recolor", (d) => {
      const it = Query.getItem(d, copy1) as Item;
      if (it.type === "rect") it.fill = solid(rgba(0, 0, 220));
    });
    commands.paste(store); // second paste from the SAME clipboard
    const copy2 = items(store).find((i) => i.id !== A && i.id !== copy1)!;
    expect(copy2.fill.type).toBe("solid");
    if (copy2.fill.type !== "solid") throw new Error();
    expect(copy2.fill.color.r).toBe(220); // still red — clipboard untouched
    expect(copy2.fill.color.b).toBe(0);
  });

  it("copies a multi-selection (both items)", () => {
    const { store, ids } = setup(2);
    commands.copy(store);
    commands.delete(store); // clear the doc
    expect(items(store)).toHaveLength(0);
    commands.paste(store);
    expect(items(store)).toHaveLength(2); // both came back
    void ids;
  });

  it("Copy with no selection clears the clipboard (Paste no-op)", () => {
    const { store } = setup();
    store.setSelection([]);
    commands.copy(store); // empty selection → empty clipboard
    commands.paste(store);
    expect(items(store)).toHaveLength(1); // nothing pasted
  });
});
