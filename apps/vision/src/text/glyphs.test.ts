import { describe, it, expect } from "vitest";
import {
  GLYPH_CATEGORIES, appendGlyph, categoryChars, defaultSpec, fullText, insertGlyph, mergedFeatures,
} from "./spec";

// Type ▸ Glyphs. The panel browses a font's repertoire per Unicode category and
// applies an OpenType alternate to ONE character. Which candidates a font
// actually draws is a canvas probe (fontCoverage in raster.ts, no DOM here), so
// what's covered below is the part that decides the panel's contents and the
// per-glyph run splicing that makes an alternate stick to a single glyph.

describe("categoryChars", () => {
  it("expands a category's ranges ascending, with no whitespace", () => {
    const basic = categoryChars("basic");
    expect(basic[0]).toBe("!");           // U+0021, not the space before it
    expect(basic.at(-1)).toBe("~");       // U+007E
    expect(basic).toHaveLength(0x7e - 0x21 + 1);
    expect(basic.some((ch) => /\s/u.test(ch))).toBe(false);
  });

  it("de-duplicates codepoints shared by two ranges", () => {
    const chars = categoryChars("punctuation");
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("covers a category the old fixed list could not (Greek, Cyrillic)", () => {
    expect(categoryChars("greek")).toContain("π");
    expect(categoryChars("cyrillic")).toContain("Ж");
  });

  it("returns nothing for an unknown category", () => {
    expect(categoryChars("nope")).toEqual([]);
  });

  it("every declared category yields candidates", () => {
    for (const cat of GLYPH_CATEGORIES) expect(categoryChars(cat.id).length).toBeGreaterThan(0);
  });
});

describe("appendGlyph", () => {
  it("appends the glyph to the layer text", () => {
    const next = appendGlyph(defaultSpec("Hi"), "©");
    expect(fullText(next)).toBe("Hi©");
  });

  it("carries an alternate on the inserted glyph only", () => {
    const next = appendGlyph(defaultSpec("Hi"), "R", { swsh: true });
    const tail = next.runs.at(-1)!;
    expect(tail.text).toBe("R");
    expect(tail.features).toEqual({ swsh: true });
    // The run before it keeps the plain form — this is the whole point of the
    // gap: ss01/salt/swsh are no longer all-or-nothing over a run.
    expect(next.runs[0].text).toBe("Hi");
    expect(next.runs[0].features).toBeUndefined();
    expect(mergedFeatures(next, tail)).toBe('"swsh" 1');
    expect(mergedFeatures(next, next.runs[0])).toBe("");
  });

  it("does not let the next plain glyph inherit the previous swash", () => {
    const swashed = appendGlyph(defaultSpec("A"), "R", { swsh: true });
    const plain = appendGlyph(swashed, "S");
    const tail = plain.runs.at(-1)!;
    expect(tail.text).toBe("S");
    expect(tail.features).toBeUndefined();
    expect(mergedFeatures(plain, tail)).toBe("");
  });

  it("merges consecutive plain inserts back into one run", () => {
    const twice = appendGlyph(appendGlyph(defaultSpec("Hi"), "©"), "®");
    expect(fullText(twice)).toBe("Hi©®");
    expect(twice.runs).toHaveLength(1);
  });

  it("keeps the layer's own features under a per-glyph override", () => {
    const spec = { ...defaultSpec("Hi"), features: { onum: true } };
    const next = appendGlyph(spec, "R", { swsh: true });
    expect(mergedFeatures(next, next.runs.at(-1))).toBe('"onum" 1, "swsh" 1');
  });

  it("handles an empty layer and a multi-code-unit glyph", () => {
    const next = appendGlyph(defaultSpec(""), "𝒜", { ss01: true });
    expect(fullText(next)).toBe("𝒜");
    expect(next.runs.at(-1)!.features).toEqual({ ss01: true });
  });
});

// Photoshop drops a picked glyph at the type cursor and replaces whatever is
// selected. Appending to the end of the layer (what appendGlyph did for every
// caller) is only correct when no editor is open.
describe("insertGlyph at the caret", () => {
  it("lands the glyph at the caret, not at the end", () => {
    const next = insertGlyph(defaultSpec("Hello world"), "©", [5, 5]);
    expect(fullText(next)).toBe("Hello© world");
  });

  it("replaces the selected range", () => {
    const next = insertGlyph(defaultSpec("Hello world"), "©", [6, 11]);
    expect(fullText(next)).toBe("Hello ©");
  });

  it("accepts a backwards selection", () => {
    const next = insertGlyph(defaultSpec("Hello world"), "©", [11, 6]);
    expect(fullText(next)).toBe("Hello ©");
  });

  it("clamps a stale selection to the current text", () => {
    const next = insertGlyph(defaultSpec("Hi"), "©", [40, 90]);
    expect(fullText(next)).toBe("Hi©");
    expect(insertGlyph(defaultSpec("Hi"), "©", [-5, -5])).toEqual(
      expect.objectContaining({ runs: [expect.objectContaining({ text: "©Hi" })] }),
    );
  });

  it("carries the alternate on the inserted glyph only, mid-string", () => {
    const next = insertGlyph(defaultSpec("Hello world"), "R", [5, 5], { swsh: true });
    expect(fullText(next)).toBe("HelloR world");
    const swashed = next.runs.filter((r) => r.features);
    expect(swashed).toHaveLength(1);
    expect(swashed[0].text).toBe("R");
    expect(swashed[0].features).toEqual({ swsh: true });
  });

  it("does not let the neighbours inherit the alternate", () => {
    // Insert a swash mid-string, then a plain glyph right after it: the plain
    // one must not pick the swash run's features up (setText's caret-inherit).
    const swashed = insertGlyph(defaultSpec("AB"), "R", [1, 1], { swsh: true }); // "ARB"
    const plain = insertGlyph(swashed, "S", [2, 2]); // "ARSB"
    expect(fullText(plain)).toBe("ARSB");
    expect(plain.runs.find((r) => r.text.includes("S"))!.features).toBeUndefined();
    expect(plain.runs.find((r) => r.text === "R")!.features).toEqual({ swsh: true });
  });

  it("appends when no editor is open (appendGlyph's contract)", () => {
    expect(fullText(insertGlyph(defaultSpec("Hi"), "©", null))).toBe("Hi©");
    expect(insertGlyph(defaultSpec("Hi"), "©", null)).toEqual(appendGlyph(defaultSpec("Hi"), "©"));
  });
});
