// ops/text-styles.test - document-backed type style presets

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  makeDocument,
  makeRect,
  makeText,
  rgba,
  solid,
  type TextItem,
  type TextLayoutSnapshot,
} from "../index";

const layout = (): TextLayoutSnapshot => ({
  engine: "test",
  version: 1,
  runs: [{ start: 0, end: 6, source: "manual" }],
});

describe("text style operations", () => {
  it("captures, applies, and round-trips character and paragraph styles", () => {
    const doc = makeDocument("Type Styles");
    const source = makeText("Source", 0, 0, {
      fontFamily: "Georgia, serif",
      fontSize: 24,
      fontWeight: 700,
      fontStyle: "italic",
      letterSpacing: 2,
      lineHeight: 1.4,
      align: "center",
      fill: solid(rgba(220, 20, 60)),
    });
    Object.assign(source, {
      baselineShift: 3,
      horizontalScale: 90,
      verticalScale: 105,
      kerning: "none",
      underline: true,
      caps: "all",
      language: "ja",
      direction: "rtl",
      writingMode: "vertical-rl",
      glyphOrientation: "upright",
      features: [{ tag: "liga", value: false }],
      spaceBefore: 8,
      spaceAfter: 12,
      indentLeft: 16,
      indentRight: 4,
      indentFirst: -6,
    } satisfies Partial<TextItem>);

    const target = makeText("Target", 0, 80, {
      fontFamily: "Arial, sans-serif",
      fontSize: 10,
      lineHeight: 1,
      align: "left",
      fill: solid(rgba(0, 0, 0)),
    });
    target.strikethrough = true;
    target.layout = layout();
    target.appearance = {
      entries: [{ id: "target-fill", kind: "fill", paint: target.fill }],
    };
    doc.layers[0].items.push(source, target);

    const characterStyleId = Ops.TextStyles.createCharacterStyleFromSelection(doc, [source.id], "Display", {
      id: "cstyle-display",
      now: "2026-07-03T00:00:00.000Z",
    })!;
    const paragraphStyleId = Ops.TextStyles.createParagraphStyleFromSelection(doc, [source.id], "Intro", {
      id: "pstyle-intro",
      now: "2026-07-03T00:00:00.000Z",
    })!;

    expect(doc.characterStyles?.[0]).toMatchObject({ id: characterStyleId, name: "Display" });
    expect(doc.paragraphStyles?.[0]).toMatchObject({ id: paragraphStyleId, name: "Intro" });

    expect(Ops.TextStyles.applyCharacterStyle(doc, [target.id], characterStyleId)).toEqual([target.id]);
    expect(target).toMatchObject({
      fontFamily: "Georgia, serif",
      fontSize: 24,
      fontWeight: 700,
      fontStyle: "italic",
      letterSpacing: 2,
      lineHeight: 1.4,
      baselineShift: 3,
      horizontalScale: 90,
      verticalScale: 105,
      kerning: "none",
      underline: true,
      caps: "all",
      language: "ja",
      direction: "rtl",
      writingMode: "vertical-rl",
      glyphOrientation: "upright",
    });
    expect(target.strikethrough).toBeUndefined();
    expect(target.features).toEqual([{ tag: "liga", value: false }]);
    expect(target.fill).toMatchObject({ type: "solid", color: { r: 220, g: 20, b: 60 } });
    expect(target.appearance?.entries[0]).toMatchObject({ kind: "fill", paint: { type: "solid", color: { r: 220, g: 20, b: 60 } } });
    expect(target.layout).toBeUndefined();

    target.layout = layout();
    expect(Ops.TextStyles.applyParagraphStyle(doc, [target.id], paragraphStyleId)).toEqual([target.id]);
    expect(target).toMatchObject({
      align: "center",
      lineHeight: 1.4,
      spaceBefore: 8,
      spaceAfter: 12,
      indentLeft: 16,
      indentRight: 4,
      indentFirst: -6,
    });
    expect(target.layout).toBeUndefined();

    const restored = IO.deserializeDocument(IO.serializeDocument(doc));
    expect(restored.characterStyles).toEqual(doc.characterStyles);
    expect(restored.paragraphStyles).toEqual(doc.paragraphStyles);
  });

  it("guards incompatible selections and deletes styles", () => {
    const doc = makeDocument("Type Style Guards");
    const rect = makeRect(0, 0, 20, 20);
    const text = makeText("Body", 0, 40);
    doc.layers[0].items.push(rect, text);

    expect(Ops.TextStyles.createCharacterStyleFromSelection(doc, [rect.id], "Bad")).toBeNull();
    expect(Ops.TextStyles.createParagraphStyleFromSelection(doc, [], "Bad")).toBeNull();

    const characterStyleId = Ops.TextStyles.createCharacterStyleFromSelection(doc, [text.id], "", { id: "cstyle-default" })!;
    const paragraphStyleId = Ops.TextStyles.createParagraphStyleFromSelection(doc, [text.id], "", { id: "pstyle-default" })!;

    expect(doc.characterStyles?.[0].name).toBe("Character Style 1");
    expect(doc.paragraphStyles?.[0].name).toBe("Paragraph Style 1");
    expect(Ops.TextStyles.applyCharacterStyle(doc, [rect.id], characterStyleId)).toEqual([]);
    expect(Ops.TextStyles.applyParagraphStyle(doc, [rect.id], paragraphStyleId)).toEqual([]);
    expect(Ops.TextStyles.deleteCharacterStyle(doc, "missing")).toBe(false);
    expect(Ops.TextStyles.deleteParagraphStyle(doc, "missing")).toBe(false);
    expect(Ops.TextStyles.deleteCharacterStyle(doc, characterStyleId)).toBe(true);
    expect(Ops.TextStyles.deleteParagraphStyle(doc, paragraphStyleId)).toBe(true);
    expect(doc.characterStyles).toHaveLength(0);
    expect(doc.paragraphStyles).toHaveLength(0);
  });
});
