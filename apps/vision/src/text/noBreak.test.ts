// ─────────────────────────────────────────────────────────────
// noBreak.test — Character ▸ No Break, plus the Paragraph-panel composition
// settings now living on TextSpec itself (hyphenate / hyphenation /
// justification / lineComposer). Pure Cell-level checks,
// hangingPunctuation is covered by hangingPunctuation.test — this file never
// actually exercised it despite the old header claiming so.
// no DOM — same shape as compose.test.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { wrapPara, type Cell } from "./raster";
import {
  defaultSpec, resolveStyle, hyphenationOf, justificationOf,
  DEFAULT_JUSTIFICATION, LINE_COMPOSERS, type TextSpec,
} from "./spec";

/** A minimal Cell: letters advance 10px, spaces 5px, drawSize 16. */
const cell = (glyph: string, advance: number, noBreak = false): Cell => ({
  glyph, baseGlyph: glyph, markGlyph: "", bidi: "ltr", diacriticX: 0, diacriticY: 0,
  font: "16px sans-serif", drawSize: 16, baseShift: 0, advance, wRaw: advance,
  ascent: 12.8, descent: 3.2, nominalSize: 16, isSpace: /^\s$/.test(glyph), isBreak: false,
  color: [0, 0, 0, 255], underline: false, strike: false, kerning: "none", tracking: 0,
  hScale: 1, vScale: 1, fauxBold: false, fauxItalic: false, features: "", noBreak,
});
/** Cells for `text`, with the characters in [nb0,nb1) marked No Break. */
const cellsOf = (text: string, nb0 = -1, nb1 = -1): Cell[] =>
  Array.from(text).map((ch, i) =>
    cell(ch, ch === " " ? 5 : 10, i >= nb0 && i < nb1));
const lineText = (l: Cell[]) => l.map((c) => c.glyph).join("");

const para = (boxW: number, extra: Partial<TextSpec> = {}): TextSpec =>
  ({ ...defaultSpec(""), kind: "paragraph", boxW, ...extra });

describe("wrapPara — Character ▸ No Break", () => {
  // "bb cc" is a no-break span: its inner space must not become a line break.
  const marked = () => cellsOf("aaa bb cc d", 4, 9);

  it("splits the span when No Break is off", () => {
    expect(wrapPara(cellsOf("aaa bb cc d"), para(60)).map(lineText))
      .toEqual(["aaa bb ", "cc d"]);
  });

  it("keeps a no-break span whole, inner spaces included", () => {
    expect(wrapPara(marked(), para(60)).map(lineText))
      .toEqual(["aaa ", "bb cc d"]);
  });

  it("keeps it whole under the every-line composer too", () => {
    expect(wrapPara(marked(), para(60, { lineComposer: "everyline" })).map(lineText))
      .toEqual(["aaa ", "bb cc d"]);
  });

  it("never hyphenates inside a no-break span", () => {
    const opts = { hyphenate: true, hyphenation: { zone: 0 } } satisfies Partial<TextSpec>;
    // without No Break the word breaks at "ba-"; marked, it wraps whole
    expect(wrapPara(cellsOf("aaa banana"), para(66, opts)).map(lineText))
      .toEqual(["aaa ba-", "nana"]);
    expect(wrapPara(cellsOf("aaa banana", 4, 10), para(66, opts)).map(lineText))
      .toEqual(["aaa ", "banana"]);
  });
});

describe("composition settings on TextSpec", () => {
  it("resolves No Break per run, defaulting to off", () => {
    expect(resolveStyle(defaultSpec(), { text: "x" }).noBreak).toBe(false);
    expect(resolveStyle(defaultSpec(), { text: "x", noBreak: true }).noBreak).toBe(true);
  });

  it("falls back to Photoshop's factory defaults when unset", () => {
    expect(justificationOf(defaultSpec())).toEqual(DEFAULT_JUSTIFICATION);
    expect(hyphenationOf(defaultSpec()).wordsLongerThan).toBe(5);
  });

  it("merges a partial dialog patch over the defaults", () => {
    const spec = defaultSpec("x", { justification: { autoLeading: 150, glyphMax: 110 } });
    expect(justificationOf(spec)).toEqual({ ...DEFAULT_JUSTIFICATION, autoLeading: 150, glyphMax: 110 });
    expect(hyphenationOf(defaultSpec("x", { hyphenation: { zone: 0 } })).zone).toBe(0);
  });

  it("offers both composers to the Paragraph panel", () => {
    expect(LINE_COMPOSERS.map((c) => c.id)).toEqual(["single", "everyline"]);
  });
});
