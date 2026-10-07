// ─────────────────────────────────────────────────────────────
// io/svg-text-export.test — text font attributes survive SVG export
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator SVG export keeps character styling. The Type panel
// exposes italic, tracking, justify and leading; these must be written to the
// exported <text> (italic + tracking as standard SVG attributes, justify + leading
// as private data-* the importer reads back) so a save→reopen is faithful. Default
// values stay out of the output to keep it terse. (The import side needs a DOM and
// is covered in-app, not here, since the vitest env is node.)

import { describe, it, expect } from "vitest";
import { IO, makeDocument, makeText, Ops, type TextItem } from "../index";

const exportText = (mutate: (t: TextItem) => void): string => {
  const doc = makeDocument("Doc", 400, 300);
  const t = makeText("Hi", 20, 40, { fontSize: 24 });
  mutate(t);
  Ops.Items.addItem(doc, t);
  return IO.exportSVG(doc);
};

describe("exportSVG — text font attributes", () => {
  it("emits font-style for italic and letter-spacing for tracking", () => {
    const svg = exportText((t) => {
      t.fontStyle = "italic";
      t.letterSpacing = 2;
    });
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('letter-spacing="2"');
  });

  it("persists justify alignment and non-default leading as data-* attributes", () => {
    const svg = exportText((t) => {
      t.align = "justify";
      t.lineHeight = 1.5;
    });
    expect(svg).toContain('data-align="justify"');
    expect(svg).toContain('data-line-height="1.5"');
  });

  it("persists advanced character/paragraph fields as data-* attributes", () => {
    const svg = exportText((t) => {
      t.baselineShift = 3;
      t.horizontalScale = 150;
      t.verticalScale = 80;
      t.kerning = "none";
      t.spaceBefore = 6;
      t.spaceAfter = 4;
      t.indentLeft = 10;
      t.indentRight = 8;
      t.indentFirst = -5;
    });
    expect(svg).toContain('data-baseline-shift="3"');
    expect(svg).toContain('data-h-scale="150"');
    expect(svg).toContain('data-v-scale="80"');
    expect(svg).toContain('data-kerning="none"');
    expect(svg).toContain('data-space-before="6"');
    expect(svg).toContain('data-space-after="4"');
    expect(svg).toContain('data-indent-left="10"');
    expect(svg).toContain('data-indent-right="8"');
    expect(svg).toContain('data-indent-first="-5"');
  });

  it("omits the attributes for default (normal / 0 / left / 1.2 / 100%) text", () => {
    const svg = exportText(() => {});
    expect(svg).not.toContain("font-style=");
    expect(svg).not.toContain("letter-spacing=");
    expect(svg).not.toContain("data-align=");
    expect(svg).not.toContain("data-line-height=");
    expect(svg).not.toContain("data-baseline-shift=");
    expect(svg).not.toContain("data-h-scale=");
    expect(svg).not.toContain("data-kerning=");
    expect(svg).not.toContain("data-space-before=");
    expect(svg).not.toContain("data-indent-left=");
  });
});
