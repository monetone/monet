// ─────────────────────────────────────────────────────────────
// panels-type-edit.test — Type panel cooperates with inline text editing
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — changing a font in the Character panel WHILE a
// type object is being edited keeps editing the same object and folds the change
// into the in-progress edit; it must not discard the text typed so far. We drive a
// real ArtisanStore exactly as PropertiesPanel + the Type tool do.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeText, Ops, Query, type TextItem } from "./engine";

const get = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id) as TextItem;

// Mirror PropertiesPanel.editText: during an open inline-edit transaction on the
// selected text, fold the change in via mutate(); otherwise it's its own step.
const makeEditText = (store: ArtisanStore) => (label: string, fn: (d: ReturnType<ArtisanStore["getState"]>["doc"]) => void) => {
  const st = store.getState();
  const id = st.selection[0];
  if (st.editingTextId && st.editingTextId === id && store.transactionBase) store.mutate(fn);
  else store.transact(label, fn);
};

const typeInto = (store: ArtisanStore, id: string, text: string) =>
  store.mutate((d) => {
    const l = Query.findItem(d, id);
    if (l && l.item.type === "text") {
      l.item.text = text;
      l.item.runs = undefined;
    }
  });

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const t = makeText("Hi", 10, 20, { fontSize: 48 });
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([t.id]);
  return { store, id: t.id };
};

describe("Type panel + inline editing (Illustrator parity)", () => {
  it("a panel font change during an inline edit folds into the edit and does not strand typed text", () => {
    const { store, id } = setup();
    const editText = makeEditText(store);

    // Enter inline edit (Type tool / double-click both do begin + setEditingText).
    store.beginTransaction("Edit Text");
    store.setEditingText(id);

    // Change the font via the panel mid-edit.
    editText("Font", (d) => Ops.Text.setFontFamily(d, [id], "Georgia, serif"));

    // The inline-edit transaction is STILL open (not force-committed) and we're
    // still editing the same object.
    expect(store.transactionBase).not.toBeNull();
    expect(store.getState().editingTextId).toBe(id);

    // Continue typing, then finish the edit.
    typeInto(store, id, "Hello");
    store.endTransaction();

    expect(get(store, id).text).toBe("Hello");
    expect(get(store, id).fontFamily).toBe("Georgia, serif");

    // The whole edit is ONE undoable step; the typed text was never lost to an
    // unrecoverable intermediate commit.
    store.undo();
    expect(get(store, id).text).toBe("Hi");
    expect(get(store, id).fontFamily).toBe("Helvetica, Arial, sans-serif");
    expect(store.canUndo).toBe(false);
  });

  it("outside an inline edit, a panel font change is its own committed undo step", () => {
    const { store, id } = setup();
    const editText = makeEditText(store);
    editText("Font", (d) => Ops.Text.setFontFamily(d, [id], "Georgia, serif"));
    expect(store.transactionBase).toBeNull(); // committed immediately
    expect(get(store, id).fontFamily).toBe("Georgia, serif");
    store.undo();
    expect(get(store, id).fontFamily).toBe("Helvetica, Arial, sans-serif");
  });
});
