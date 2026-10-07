// panels-character-paragraph.test - Character / Paragraph panel transactions

import { describe, expect, it } from "vitest";
import { ArtisanStore, makeDocument, makeRect, makeText, Ops, Query, type Document, type TextItem } from "./engine";

const getText = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id) as TextItem;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Type");
  const text = makeText("Type", 10, 20, { fontSize: 24 });
  doc.layers[0].items.push(text);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([text.id]);
  return { store, text };
};

const panelEdit = (store: ArtisanStore, label: string, fn: (doc: Document) => void) => {
  const st = store.getState();
  const textItems = st.selection.map((id) => Query.getItem(st.doc, id)).filter((item): item is TextItem => !!item && item.type === "text");
  const editingSelectedText = !!st.editingTextId && textItems.some((item) => item.id === st.editingTextId);
  if (editingSelectedText && store.transactionBase) store.mutate(fn);
  else store.transact(label, fn);
};

describe("Character and Paragraph panel transactions", () => {
  it("applies character edits to selected text as undoable steps", () => {
    const { store, text } = setup();
    const selection = store.getState().selection;

    panelEdit(store, "Font Weight", (doc) => Ops.Text.setFontWeight(doc, selection, 700));
    panelEdit(store, "Leading", (doc) => Ops.Text.setLineHeight(doc, selection, 1.5));
    panelEdit(store, "Tracking", (doc) => Ops.Text.setLetterSpacing(doc, selection, 12));
    panelEdit(store, "Baseline Shift", (doc) => Ops.Text.setBaselineShift(doc, selection, 3));
    panelEdit(store, "Writing Mode", (doc) => Ops.Text.setWritingMode(doc, selection, "vertical-rl"));

    expect(getText(store, text.id)).toMatchObject({
      fontWeight: 700,
      lineHeight: 1.5,
      letterSpacing: 12,
      baselineShift: 3,
      writingMode: "vertical-rl",
    });

    store.undo();
    expect(getText(store, text.id).writingMode).toBeUndefined();
  });

  it("applies paragraph edits and point/area conversion through undoable panel actions", () => {
    const { store, text } = setup();
    const selection = store.getState().selection;

    panelEdit(store, "Convert to Area Type", (doc) => Ops.Text.convertText(doc, selection, "area"));
    panelEdit(store, "Align Text", (doc) => Ops.Text.setAlign(doc, selection, "justify"));
    panelEdit(store, "Space Before", (doc) => Ops.Text.setSpaceBefore(doc, selection, 8));
    panelEdit(store, "Left Indent", (doc) => Ops.Text.setIndentLeft(doc, selection, 18));
    panelEdit(store, "First-Line Indent", (doc) => Ops.Text.setIndentFirst(doc, selection, -6));

    const edited = getText(store, text.id);
    expect(edited.boxWidth).toBeGreaterThan(0);
    expect(edited.align).toBe("justify");
    expect(edited.spaceBefore).toBe(8);
    expect(edited.indentLeft).toBe(18);
    expect(edited.indentFirst).toBe(-6);

    store.undo();
    expect(getText(store, text.id).indentFirst).toBeUndefined();
  });

  it("applies mixed-selection panel edits only to text items", () => {
    const store = new ArtisanStore();
    const doc = makeDocument("Mixed Type");
    const text = makeText("A", 0, 0);
    const rect = makeRect(20, 0, 10, 10, 0, 0);
    doc.layers[0].items.push(text, rect);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([text.id, rect.id]);

    panelEdit(store, "Font Size", (d) => Ops.Text.setFontSize(d, store.getState().selection, 36));

    expect(getText(store, text.id).fontSize).toBe(36);
    expect((Query.getItem(store.getState().doc, rect.id) as unknown as Record<string, unknown>).fontSize).toBeUndefined();
  });
});
