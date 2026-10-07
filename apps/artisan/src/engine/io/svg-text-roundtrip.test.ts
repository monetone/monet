// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// io/svg-text-roundtrip.test — text survives an SVG export → import cycle
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator round-trips type through SVG. Exercises the import
// side (needs a DOM, hence the happy-dom environment) to lock in the fixes for:
//  • multi-line point text re-importing as a diagonal rich-run "staircase";
//  • advanced Character/Paragraph fields (data-*) round-tripping;
//  • area-type (boxWidth) and type-on-path (pathD) reopening as themselves, not
//    degrading to point text.

import { describe, it, expect } from "vitest";
import { IO, makeDocument, makeText, Ops, type Document, type Item, type TextItem } from "../index";
import { importSVG } from "../../io/import/svg";

const findText = (doc: Document): TextItem | null => {
  const walk = (items: Item[]): TextItem | null => {
    for (const it of items) {
      if (it.type === "text") return it;
      if (it.type === "group") {
        const r = walk(it.children);
        if (r) return r;
      }
    }
    return null;
  };
  for (const l of doc.layers) {
    const r = walk(l.items);
    if (r) return r;
  }
  return null;
};

const roundTrip = (text: string, mutate: (t: TextItem) => void = () => {}): TextItem => {
  const doc = makeDocument("Doc", 400, 300);
  const t = makeText(text, 20, 40, { fontSize: 24 });
  mutate(t);
  Ops.Items.addItem(doc, t);
  const reimported = importSVG(IO.exportSVG(doc));
  const found = findText(reimported);
  if (!found) throw new Error("no text item survived the round-trip");
  return found;
};

describe("SVG text round-trip (export → import)", () => {
  it("multi-line point text comes back as plain \\n text, NOT rich runs (no staircase)", () => {
    const t = roundTrip("Line one\nLine two\nLine three");
    expect(t.text).toBe("Line one\nLine two\nLine three");
    expect(t.runs).toBeUndefined();
  });

  it("preserves italic and tracking", () => {
    const t = roundTrip("Hi", (x) => {
      x.fontStyle = "italic";
      x.letterSpacing = 2;
    });
    expect(t.fontStyle).toBe("italic");
    expect(t.letterSpacing).toBe(2);
  });

  it("preserves leading and justify alignment", () => {
    const t = roundTrip("Hi", (x) => {
      x.lineHeight = 1.5;
      x.align = "justify";
      x.boxWidth = 180; // justify is meaningful for area type
      x.boxHeight = 90;
    });
    expect(t.lineHeight).toBe(1.5);
    expect(t.align).toBe("justify");
  });

  it("preserves advanced Character/Paragraph fields", () => {
    const t = roundTrip("Hi", (x) => {
      x.baselineShift = 3;
      x.horizontalScale = 150;
      x.verticalScale = 80;
      x.kerning = "none";
      x.spaceBefore = 6;
      x.spaceAfter = 4;
      x.indentLeft = 10;
      x.indentRight = 8;
      x.indentFirst = -5;
    });
    expect(t.baselineShift).toBe(3);
    expect(t.horizontalScale).toBe(150);
    expect(t.verticalScale).toBe(80);
    expect(t.kerning).toBe("none");
    expect(t.spaceBefore).toBe(6);
    expect(t.spaceAfter).toBe(4);
    expect(t.indentLeft).toBe(10);
    expect(t.indentRight).toBe(8);
    expect(t.indentFirst).toBe(-5);
  });

  it("area-type (boxWidth/boxHeight) reopens as area type, not point text", () => {
    const t = roundTrip("Box one\nBox two", (x) => {
      x.boxWidth = 200;
      x.boxHeight = 120;
    });
    expect(t.boxWidth).toBe(200);
    expect(t.boxHeight).toBe(120);
    expect(t.text).toBe("Box one\nBox two");
  });

  it("type-on-path (pathD) reopens as path type", () => {
    const t = roundTrip("On a path", (x) => {
      x.pathD = "M0 0 L100 0";
    });
    expect(t.pathD).toBe("M0 0 L100 0");
  });

  it("keeps a genuinely styled run as item.runs (does NOT collapse to a line stack)", () => {
    // Regression guard for the multi-line fix: weight/style-differentiated tspans
    // must still import as rich runs (canvas-independent, unlike fill-based runs).
    const t = roundTrip("AB", (x) => {
      x.runs = [
        { text: "A", fontWeight: 700 },
        { text: "B", fontStyle: "italic" },
      ];
    });
    expect(t.runs).toBeDefined();
    expect(t.runs).toHaveLength(2);
    expect(t.runs![0].fontWeight).toBe(700);
    expect(t.runs![1].fontStyle).toBe("italic");
  });

  it("preserves shaping metadata for future font engines", () => {
    const t = roundTrip("ABC", (x) => {
      x.language = "ar";
      x.direction = "rtl";
      x.writingMode = "vertical-rl";
      x.glyphOrientation = "upright";
      x.features = [{ tag: "liga", value: false }];
      x.fontResolution = {
        requestedFamily: "Missing Arabic",
        resolvedFamily: "Noto Sans Arabic",
        status: "substituted",
        substitutedFor: "Missing Arabic",
        fallbacks: [{ family: "Noto Sans Arabic", status: "resolved", source: "system" }],
      };
      x.runs = [
        { text: "A", fontFamily: "Source Serif", fontSize: 20, language: "en", direction: "ltr", features: [{ tag: "kern", value: true }] },
        { text: "BC", fontWeight: 700 },
      ];
    });
    expect(t.language).toBe("ar");
    expect(t.direction).toBe("rtl");
    expect(t.writingMode).toBe("vertical-rl");
    expect(t.glyphOrientation).toBe("upright");
    expect(t.features).toEqual([{ tag: "liga", value: false }]);
    expect(t.fontResolution?.resolvedFamily).toBe("Noto Sans Arabic");
    expect(t.runs?.[0]).toMatchObject({
      text: "A",
      fontFamily: "Source Serif",
      fontSize: 20,
      language: "en",
      direction: "ltr",
      features: [{ tag: "kern", value: true }],
    });
    expect(t.runs?.[1].fontWeight).toBe(700);
  });

  it("plain default text round-trips with no spurious advanced fields", () => {
    const t = roundTrip("Plain");
    expect(t.text).toBe("Plain");
    expect(t.runs).toBeUndefined();
    expect(t.baselineShift).toBeUndefined();
    expect(t.boxWidth).toBeUndefined();
    expect(t.pathD).toBeUndefined();
  });
});
