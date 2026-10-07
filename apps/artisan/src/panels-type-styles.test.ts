// panels-type-styles.test - Type Styles panel store transactions

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, makeDocument, makeText } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Type Styles");
  const source = makeText("Headline", 0, 0, {
    fontFamily: "Georgia, serif",
    fontSize: 28,
    fontWeight: 700,
    fontStyle: "italic",
    letterSpacing: 1.5,
    lineHeight: 1.3,
    align: "center",
  });
  source.spaceBefore = 6;
  source.indentFirst = -4;
  const target = makeText("Body", 0, 60);
  doc.layers[0].items.push(source, target);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([source.id]);
  return { store, source, target };
};

describe("Type Styles panel transactions", () => {
  it("creates and applies character and paragraph styles as undoable transactions", () => {
    const { store, source, target } = setup();

    store.transact("New Character Style", (doc) => {
      Ops.TextStyles.createCharacterStyleFromSelection(doc, store.getState().selection, "Display");
    });
    store.transact("New Paragraph Style", (doc) => {
      Ops.TextStyles.createParagraphStyleFromSelection(doc, store.getState().selection, "Intro");
    });

    let state = store.getState();
    const characterStyle = state.doc.characterStyles![0];
    const paragraphStyle = state.doc.paragraphStyles![0];
    expect(characterStyle.name).toBe("Display");
    expect(paragraphStyle.name).toBe("Intro");

    store.setSelection([target.id]);
    store.transact("Apply Type Styles", (doc) => {
      Ops.TextStyles.applyCharacterStyle(doc, store.getState().selection, characterStyle.id);
      Ops.TextStyles.applyParagraphStyle(doc, store.getState().selection, paragraphStyle.id);
    });

    state = store.getState();
    const styled = state.doc.layers[0].items[1];
    expect(styled).toMatchObject({
      type: "text",
      fontFamily: source.fontFamily,
      fontSize: source.fontSize,
      fontWeight: source.fontWeight,
      fontStyle: source.fontStyle,
      letterSpacing: source.letterSpacing,
      align: source.align,
      spaceBefore: source.spaceBefore,
      indentFirst: source.indentFirst,
    });

    store.undo();
    const restored = store.getState().doc.layers[0].items[1];
    expect(restored).toMatchObject({
      type: "text",
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: 48,
      fontWeight: 400,
      fontStyle: "normal",
      letterSpacing: 0,
      align: "left",
    });
    expect(store.getState().doc.characterStyles).toHaveLength(1);
    expect(store.getState().doc.paragraphStyles).toHaveLength(1);
  });
});
