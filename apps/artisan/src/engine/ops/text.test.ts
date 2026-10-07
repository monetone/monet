// ─────────────────────────────────────────────────────────────
// ops/text.test — TEXT character/paragraph edits (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Character + Paragraph panels — changing font
// family, size, weight, style, leading, tracking or alignment on a selected type
// object applies to the whole object (when no characters are sub-selected) and is
// one undoable step. We drive a real ArtisanStore exactly as the Type panel does
// (store.transact → Ops.Text.*).

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeGroup, makeText, makeRect, Ops, Query, type TextItem } from "../index";

const setup = (item = makeText("Hello", 10, 20, { fontSize: 48 })) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.layers[0].items.push(item);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([item.id]);
  return { store, id: item.id };
};
const get = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id) as TextItem;

describe("Ops.Text — character & paragraph edits", () => {
  it("setFontFamily changes the family and is undoable", () => {
    const { store, id } = setup();
    expect(get(store, id).fontFamily).toBe("Helvetica, Arial, sans-serif");
    store.transact("Font", (d) => Ops.Text.setFontFamily(d, [id], "Georgia, serif"));
    expect(get(store, id).fontFamily).toBe("Georgia, serif");
    expect(get(store, id).fontResolution).toEqual({
      requestedFamily: "Georgia, serif",
      status: "unresolved",
      fallbacks: [
        { family: "Georgia", source: "system", status: "unresolved" },
        { family: "serif", source: "generic", status: "unresolved" },
      ],
    });
    store.undo();
    expect(get(store, id).fontFamily).toBe("Helvetica, Arial, sans-serif");
  });

  it("setFontSize changes the size and clamps to a positive minimum", () => {
    const { store, id } = setup();
    store.transact("Font Size", (d) => Ops.Text.setFontSize(d, [id], 72));
    expect(get(store, id).fontSize).toBe(72);
    store.transact("Font Size", (d) => Ops.Text.setFontSize(d, [id], 0));
    expect(get(store, id).fontSize).toBeGreaterThan(0);
  });

  it("setFontWeight changes the weight (rounded, clamped) and is undoable", () => {
    const { store, id } = setup();
    store.transact("Font Weight", (d) => Ops.Text.setFontWeight(d, [id], 700));
    expect(get(store, id).fontWeight).toBe(700);
    store.undo();
    expect(get(store, id).fontWeight).toBe(400);
  });

  it("setFontWeight clears per-run weight overrides so the change is visible everywhere", () => {
    const item = makeText("AB", 0, 0);
    item.runs = [
      { text: "A", fontWeight: 700 },
      { text: "B" },
    ];
    const { store, id } = setup(item);
    store.transact("Font Weight", (d) => Ops.Text.setFontWeight(d, [id], 300));
    const t = get(store, id);
    expect(t.fontWeight).toBe(300);
    expect(t.runs?.every((r) => r.fontWeight === undefined)).toBe(true);
  });

  it("toggleItalic flips style on then off and clears per-run style overrides", () => {
    const item = makeText("AB", 0, 0);
    item.runs = [{ text: "A", fontStyle: "italic" }, { text: "B" }];
    const { store, id } = setup(item);
    store.transact("Italic", (d) => Ops.Text.toggleItalic(d, [id]));
    expect(get(store, id).fontStyle).toBe("italic");
    expect(get(store, id).runs?.every((r) => r.fontStyle === undefined)).toBe(true);
    store.transact("Italic", (d) => Ops.Text.toggleItalic(d, [id]));
    expect(get(store, id).fontStyle).toBe("normal");
  });

  it("setAlign, setLineHeight and setLetterSpacing update paragraph/character metrics", () => {
    const { store, id } = setup();
    store.transact("Align Text", (d) => Ops.Text.setAlign(d, [id], "center"));
    store.transact("Leading", (d) => Ops.Text.setLineHeight(d, [id], 2));
    store.transact("Tracking", (d) => Ops.Text.setLetterSpacing(d, [id], -1.5));
    const t = get(store, id);
    expect(t.align).toBe("center");
    expect(t.lineHeight).toBe(2);
    expect(t.letterSpacing).toBe(-1.5);
  });

  it("setText replaces content, flattens runs, and refreshes the auto-name", () => {
    const item = makeText("old", 0, 0);
    item.runs = [{ text: "o" }, { text: "ld" }];
    const { store, id } = setup(item);
    store.transact("Text", (d) => Ops.Text.setText(d, [id], "new content"));
    const t = get(store, id);
    expect(t.text).toBe("new content");
    expect(t.runs).toBeUndefined();
    expect(t.name).toBe("new content");
  });

  it("is a no-op on non-text items (mixed selection is safe)", () => {
    const rect = makeRect(0, 0, 10, 10, 0, 0);
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.layers[0].items.push(rect);
    store.replaceDoc(doc, { markClean: true });
    // Should not throw and should not invent text fields on the rect.
    store.transact("Font", (d) => Ops.Text.setFontFamily(d, [rect.id], "Georgia, serif"));
    expect((Query.getItem(store.getState().doc, rect.id) as unknown as Record<string, unknown>).fontFamily).toBeUndefined();
  });

  it("applies to every text item in a multi-text selection in one undo step", () => {
    const a = makeText("A", 0, 0);
    const b = makeText("B", 100, 0);
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.layers[0].items.push(a, b);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([a.id, b.id]);
    store.transact("Font", (d) => Ops.Text.setFontFamily(d, store.getState().selection, "Georgia, serif"));
    expect(get(store, a.id).fontFamily).toBe("Georgia, serif");
    expect(get(store, b.id).fontFamily).toBe("Georgia, serif");
    store.undo();
    expect(get(store, a.id).fontFamily).toBe("Helvetica, Arial, sans-serif");
    expect(get(store, b.id).fontFamily).toBe("Helvetica, Arial, sans-serif");
  });

  it("edits grouped text and resolves mixed toggles and point-leading uniformly", () => {
    const a = makeText("A", 0, 0, { fontSize: 12, fontStyle: "italic" });
    const b = makeText("B", 100, 0, { fontSize: 36 });
    const group = makeGroup([a, b]);
    const doc = makeDocument();
    doc.layers[0].items.push(group);

    Ops.Text.setLeading(doc, [group.id], 20);
    Ops.Text.setFontSize(doc, [group.id], 24);
    Ops.Text.toggleItalic(doc, [group.id]);

    expect(a.lineHeight * 12).toBeCloseTo(20);
    expect(b.lineHeight * 36).toBeCloseTo(20);
    expect([a.fontSize, b.fontSize]).toEqual([24, 24]);
    expect([a.fontStyle, b.fontStyle]).toEqual(["italic", "italic"]);

    Ops.Text.toggleItalic(doc, [group.id]);
    expect([a.fontStyle, b.fontStyle]).toEqual(["normal", "normal"]);
  });

  it("advanced character setters normalize neutral defaults to undefined", () => {
    const { store, id } = setup();
    store.transact("HScale", (d) => Ops.Text.setHorizontalScale(d, [id], 150));
    expect(get(store, id).horizontalScale).toBe(150);
    store.transact("HScale", (d) => Ops.Text.setHorizontalScale(d, [id], 100));
    expect(get(store, id).horizontalScale).toBeUndefined(); // 100% is the default
    store.transact("Baseline", (d) => Ops.Text.setBaselineShift(d, [id], 5));
    expect(get(store, id).baselineShift).toBe(5);
    store.transact("Baseline", (d) => Ops.Text.setBaselineShift(d, [id], 0));
    expect(get(store, id).baselineShift).toBeUndefined();
    store.transact("Kern", (d) => Ops.Text.setKerning(d, [id], "none"));
    expect(get(store, id).kerning).toBe("none");
    store.transact("Kern", (d) => Ops.Text.setKerning(d, [id], "auto"));
    expect(get(store, id).kerning).toBeUndefined();
  });

  it("clamps glyph scale to 1..1000", () => {
    const { store, id } = setup();
    store.transact("VScale", (d) => Ops.Text.setVerticalScale(d, [id], 5000));
    expect(get(store, id).verticalScale).toBe(1000);
    store.transact("VScale", (d) => Ops.Text.setVerticalScale(d, [id], 0));
    expect(get(store, id).verticalScale).toBe(1);
  });

  it("applies paragraph setters (space + indents) and they undo", () => {
    const { store, id } = setup();
    store.transact("Before", (d) => Ops.Text.setSpaceBefore(d, [id], 8));
    store.transact("After", (d) => Ops.Text.setSpaceAfter(d, [id], 4));
    store.transact("IndentL", (d) => Ops.Text.setIndentLeft(d, [id], 12));
    store.transact("First", (d) => Ops.Text.setIndentFirst(d, [id], -6));
    const t = get(store, id);
    expect(t.spaceBefore).toBe(8);
    expect(t.spaceAfter).toBe(4);
    expect(t.indentLeft).toBe(12);
    expect(t.indentFirst).toBe(-6);
    store.undo();
    expect(get(store, id).indentFirst).toBeUndefined();
  });
});
