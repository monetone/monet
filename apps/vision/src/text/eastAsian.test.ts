// ─────────────────────────────────────────────────────────────
// Type ▸ Language Options ▸ East Asian Features (#455) — spec.eastAsian turns on
// CJK composition: kinsoku break opportunities, mojikumi (consecutive
// punctuation set solid), burasagari (、。 hanging past the right margin) and
// tate-chu-yoko (2–3 digit runs set across a vertical column). Pure Cell-level
// layout checks, the same shape as hangingPunctuation.test: every glyph is a
// 16px em, a paragraph box fits exactly 10 of them.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { applyMojikumi, layoutHorizontal, layoutVertical, wrapPara, type Cell, type Layout } from "./raster";
import { defaultSpec, type TextSpec } from "./spec";

const cell = (glyph: string, advance = 16): Cell => ({
  glyph, baseGlyph: glyph, markGlyph: "", bidi: "ltr", diacriticX: 0, diacriticY: 0,
  font: "16px sans-serif", drawSize: 16, baseShift: 0, advance, wRaw: advance,
  ascent: 12.8, descent: 3.2, nominalSize: 16, isSpace: /^\s$/.test(glyph), isBreak: false,
  color: [0, 0, 0, 255], underline: false, strike: false, kerning: "none", tracking: 0,
  hScale: 1, vScale: 1, fauxBold: false, fauxItalic: false, features: "", noBreak: false,
});
const cellsOf = (text: string): Cell[] => Array.from(text).map((ch) => cell(ch));

const para = (extra: Partial<TextSpec> = {}): TextSpec =>
  ({ ...defaultSpec("", { size: 16 }), kind: "paragraph", boxW: 160, ...extra });
const on = (extra: Partial<TextSpec> = {}) => para({ eastAsian: true, ...extra });

/** Glyphs per laid-out line, top to bottom. */
const lineGlyphs = (l: Layout): string[] => {
  const rows = new Map<number, string>();
  for (const p of l.placements) rows.set(p.y, (rows.get(p.y) ?? "") + p.cell.glyph);
  return [...rows.values()];
};
const KANJI = (n: number) => "字".repeat(n);

describe("East Asian Features: kinsoku line breaks", () => {
  it("is off unless the spec asks for it, so existing paragraphs never re-wrap", () => {
    const text = cellsOf(KANJI(20));
    const absent = layoutHorizontal(text, para());
    expect(lineGlyphs(absent), "no break opportunity in spaceless CJK today").toEqual([KANJI(20)]);
    expect(layoutHorizontal(text, para({ eastAsian: false }))).toEqual(absent);
    expect(lineGlyphs(layoutHorizontal(text, on()))).toEqual([KANJI(10), KANJI(10)]);
    // mojikumi is gated too: without the flag 」「 keep their full ems
    expect(layoutHorizontal(cellsOf("字」「字"), para()).placements.map((p) => p.x)).toEqual([0, 16, 32, 48]);
  });

  it("never starts a line with a closer or ends one with an opener", () => {
    expect(lineGlyphs(layoutHorizontal(cellsOf(KANJI(10) + "」字"), on()))).toEqual([KANJI(9), "字」字"]);
    expect(lineGlyphs(layoutHorizontal(cellsOf(KANJI(9) + "「字字"), on()))).toEqual([KANJI(9), "「字字"]);
  });
});

describe("East Asian Features: mojikumi", () => {
  const SOLID = "字字」「字字」「字字字"; // 11 ems, two 」「 pairs
  const CONTROL = "字字」字字字」字字字字"; // 11 ems, nothing to set solid

  it("sets 」「 solid, which pulls an 11-em line back into a 10-em box", () => {
    const l = layoutHorizontal(cellsOf(SOLID), on());
    expect(lineGlyphs(l)).toEqual([SOLID]);
    const x = (i: number) => l.placements[i].x;
    expect(x(3), "「 follows the half-width 」").toBe(x(2) + 8);
    expect(lineGlyphs(layoutHorizontal(cellsOf(CONTROL), on()))).toEqual(["字字」字字字」字字字", "字"]);
  });

  it("is what moves the break: the same text wraps without the compression", () => {
    expect(wrapPara(cellsOf(SOLID), on())).toHaveLength(2);
    expect(wrapPara(applyMojikumi(cellsOf(SOLID)), on())).toHaveLength(1);
  });

  it("marks a compressed cell with tracking so the native run painter skips it", () => {
    const [close, open] = applyMojikumi(cellsOf("」「"));
    expect([close.advance, close.tracking]).toEqual([8, -8]);
    expect(open.advance).toBe(16); // the last glyph has nothing after it
  });

  it("does not compress a pair the font already set tight", () => {
    const tight = { ...cell("」"), advance: 8 }; // e.g. metrics kerning did it
    expect(applyMojikumi([tight, cell("「")])[0].advance).toBe(8);
  });
});

describe("East Asian Features: burasagari", () => {
  for (const lineComposer of ["single", "everyline"] as const) {
    it(`hangs 。 past the margin instead of breaking before it (${lineComposer})`, () => {
      const hung = layoutHorizontal(cellsOf(KANJI(10) + "。字"), on({ lineComposer }));
      expect(lineGlyphs(hung)).toEqual([KANJI(10) + "。", "字"]);
      expect(hung.placements[10].x, "the stop sits outside the 160px box").toBe(160);
      // A closer may not hang, and may not start a line either.
      const closer = layoutHorizontal(cellsOf(KANJI(10) + "」字"), on({ lineComposer }));
      expect(lineGlyphs(closer)).toEqual([KANJI(9), "字」字"]);
    });
  }

  it("pushes a hanging stop out of right-aligned text, keeping the text edge flush", () => {
    const l = layoutHorizontal(cellsOf(KANJI(10) + "。字"), on({ align: "right" }));
    expect(l.placements[9].x + 16).toBe(160);
    expect(l.placements[10].x).toBe(160);
  });
});

describe("East Asian Features: tate-chu-yoko", () => {
  const vspec = (eastAsian?: boolean) => defaultSpec("", { size: 16, vertical: true, eastAsian });

  it("sets a two-digit run upright in one slot, squeezed to the column", () => {
    const l = layoutVertical(cellsOf("第12回"), vspec(true));
    expect(l.placements.map((p) => p.cell.glyph)).toEqual(["第", "12", "回"]);
    expect(l.placements[1].cell.advance).toBe(16);
    expect(l.placements[1].cell.hScale).toBe(0.5);
    const off = layoutVertical(cellsOf("第12回"), vspec());
    expect(off.placements).toHaveLength(4);
    expect(l.blockH).toBeLessThan(off.blockH);
  });

  it("takes three digits but leaves longer runs stacked", () => {
    expect(layoutVertical(cellsOf("第123回"), vspec(true)).placements.map((p) => p.cell.glyph)).toEqual(["第", "123", "回"]);
    expect(layoutVertical(cellsOf("第2026回"), vspec(true)).placements).toHaveLength(6);
  });
});
