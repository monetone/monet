// ─────────────────────────────────────────────────────────────
// compose.test — paragraph composition (hyphenation, justification,
// single/every-line composer). Pure Cell-level checks, no DOM: hyphenCell
// falls back to a 0.33 em estimate when `document` is absent, so wrapPara,
// hyphenationPoints and justifyLine are all node-testable.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  wrapPara, hyphenationPoints, justifyLine,
  DEFAULT_HYPHENATION, DEFAULT_JUSTIFICATION,
  type Cell, type Justification,
} from "./raster";
import { defaultSpec, type TextSpec } from "./spec";

/** A minimal Cell: letters advance 10px, spaces `spaceAdv`, drawSize 16. */
const cell = (glyph: string, advance: number): Cell => ({
  glyph, baseGlyph: glyph, markGlyph: "", bidi: "ltr", diacriticX: 0, diacriticY: 0,
  font: "16px sans-serif", drawSize: 16, baseShift: 0, advance, wRaw: advance,
  ascent: 12.8, descent: 3.2, nominalSize: 16, isSpace: /^\s$/.test(glyph), isBreak: false,
  color: [0, 0, 0, 255], underline: false, strike: false, kerning: "none", tracking: 0,
  hScale: 1, vScale: 1, fauxBold: false, fauxItalic: false, features: "",
});
const cellsOf = (text: string, adv = 10, spaceAdv = 5): Cell[] =>
  Array.from(text).map((ch) => cell(ch, ch === " " ? spaceAdv : adv));
const lineText = (l: Cell[]) => l.map((c) => c.glyph).join("");

const para = (boxW: number, extra: Record<string, unknown> = {}): TextSpec =>
  ({ ...defaultSpec(""), kind: "paragraph", boxW, ...extra }) as TextSpec;

describe("hyphenationPoints", () => {
  it("breaks before a consonant that opens a vowel syllable", () => {
    expect(hyphenationPoints(Array.from("better"))).toEqual([3]);  // bet-ter
    expect(hyphenationPoints(Array.from("banana"))).toEqual([2, 4]); // ba-na-na
  });

  it("returns nothing for short or non-alphabetic words", () => {
    expect(hyphenationPoints(Array.from("cat"))).toEqual([]);
    expect(hyphenationPoints(Array.from("12345678"))).toEqual([]);
  });

  it("honours afterFirst / beforeLast margins", () => {
    expect(hyphenationPoints(Array.from("banana"), { ...DEFAULT_HYPHENATION, afterFirst: 3 })).toEqual([4]);
    expect(hyphenationPoints(Array.from("banana"), { ...DEFAULT_HYPHENATION, beforeLast: 3 })).toEqual([2]);
  });
});

describe("wrapPara — single-line composer", () => {
  it("keeps the legacy greedy breaks when no composition fields are set", () => {
    // letters 10px, spaces 5px, box 40 → one word (+ its trailing space) per line
    const lines = wrapPara(cellsOf("aaa bbb ccc"), para(40));
    expect(lines.map(lineText)).toEqual(["aaa ", "bbb ", "ccc"]);
  });

  it("hyphenates a word that would otherwise wrap whole", () => {
    // "banana" fragments at [2,4]; gap 31px fits "ba" (20) + hyphen (16·0.33)
    const lines = wrapPara(cellsOf("aaa banana"), para(66, { hyphenate: true, hyphenation: { zone: 0 } }));
    expect(lines.map(lineText)).toEqual(["aaa ba-", "nana"]);
  });

  it("suppresses hyphenation inside the hyphenation zone on unjustified text", () => {
    // default zone 36px > the 31px gap → plain wrap, no hyphen
    const lines = wrapPara(cellsOf("aaa banana"), para(66, { hyphenate: true }));
    expect(lines.map(lineText)).toEqual(["aaa ", "banana"]);
  });
});

describe("wrapPara — every-line composer", () => {
  // Canonical minimum-raggedness case (letters and spaces both 10px, box 60):
  // greedy packs "aaa bb" tight and strands "cc"; the DP balances the lines.
  const cells = () => cellsOf("aaa bb cc ddddd", 10, 10);

  it("beats greedy raggedness by rebalancing earlier lines", () => {
    const greedy = wrapPara(cells(), para(60));
    const everyline = wrapPara(cells(), para(60, { lineComposer: "everyline" }));
    expect(greedy.map(lineText)).toEqual(["aaa bb ", "cc ", "ddddd"]);
    expect(everyline.map(lineText)).toEqual(["aaa ", "bb cc ", "ddddd"]);
  });

  it("preserves every glyph and never overfills a fillable line", () => {
    const lines = wrapPara(cells(), para(60, { lineComposer: "everyline" }));
    expect(lines.map(lineText).join("")).toBe("aaa bb cc ddddd");
    for (const l of lines) {
      const trimmed = l.filter((_, i) => i < l.length - (l[l.length - 1]?.isSpace ? 1 : 0));
      expect(trimmed.reduce((s, c) => s + c.advance, 0)).toBeLessThanOrEqual(60);
    }
  });
});

describe("justifyLine", () => {
  const D = DEFAULT_JUSTIFICATION;
  /** word + letter + glyph contributions must consume the need exactly. */
  const consumed = (r: { extraPerSpace: number; extraPerLetter: number; glyphScale: number }, spaces: number, gaps: number, glyphW: number) =>
    r.extraPerSpace * spaces + r.extraPerLetter * gaps + glyphW * (r.glyphScale - 1);

  it("defaults put the whole slack into word spaces (legacy behavior)", () => {
    const r = justifyLine(30, 3, 15, 8, 100, D);
    expect(r.extraPerSpace).toBeCloseTo(10);
    expect(r.extraPerLetter).toBe(0);
    expect(r.glyphScale).toBe(1);
  });

  it("overflows into letter spacing when its max allows", () => {
    const just: Justification = { ...D, letterMax: 50 };
    const r = justifyLine(30, 3, 15, 8, 100, just);
    // word max = 15·33% = 4.95, letters take 8·(15/3)·50% = 20, remainder → words
    expect(r.extraPerLetter).toBeCloseTo(2.5);
    expect(consumed(r, 3, 8, 100)).toBeCloseTo(30);
  });

  it("scales glyphs within the glyph min/max window", () => {
    const just: Justification = { ...D, glyphMax: 110 };
    const r = justifyLine(30, 3, 15, 8, 100, just);
    expect(r.glyphScale).toBeCloseTo(1.1); // +10% of the 100px of glyphs
    expect(consumed(r, 3, 8, 100)).toBeCloseTo(30);
  });

  it("compresses word spaces on negative slack", () => {
    const r = justifyLine(-20, 3, 15, 8, 100, D);
    expect(r.extraPerSpace).toBeCloseTo(-20 / 3);
    expect(r.glyphScale).toBe(1);
  });

  it("letter-spaces a space-less line (justify-all single word)", () => {
    const r = justifyLine(12, 0, 0, 4, 80, D);
    expect(r.extraPerSpace).toBe(0);
    expect(r.extraPerLetter).toBeCloseTo(3);
  });
});
