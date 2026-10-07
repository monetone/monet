import { describe, it, expect } from "vitest";
import {
  addDiscoveredFonts, defaultSpec, FONTS, fontFamilyKey, fullText, mergeRuns, applyRangeFormat, setText, resolveStyle, mergedFeatures,
  type TextRun,
} from "./spec";

const text = (runs: TextRun[]) => runs.map((r) => r.text).join("");

describe("mergeRuns", () => {
  it("collapses adjacent runs with identical formatting", () => {
    expect(mergeRuns([{ text: "a", bold: true }, { text: "b", bold: true }]))
      .toEqual([{ text: "ab", bold: true }]);
  });

  it("collapses adjacent unstyled runs", () => {
    expect(mergeRuns([{ text: "a" }, { text: "b" }])).toEqual([{ text: "ab" }]);
  });

  it("keeps differently-styled runs separate", () => {
    expect(mergeRuns([{ text: "a", bold: true }, { text: "b" }])).toHaveLength(2);
  });

  it("drops empty runs", () => {
    expect(mergeRuns([{ text: "" }, { text: "x" }, { text: "" }])).toEqual([{ text: "x" }]);
  });

  it("returns a single empty run when everything is empty", () => {
    expect(mergeRuns([{ text: "" }, { text: "" }])).toEqual([{ text: "" }]);
  });
});

describe("applyRangeFormat", () => {
  it("patches axes per run only within the selected range", () => {
    expect(applyRangeFormat([
      { text: "AB", axes: { wdth: 100, slnt: -2 } },
      { text: "CD", axes: { wdth: 110, slnt: -7 } },
    ], 1, 3, { axes: { wdth: 125 } })).toEqual([
      { text: "A", axes: { wdth: 100, slnt: -2 } },
      { text: "B", axes: { wdth: 125, slnt: -2 } },
      { text: "C", axes: { wdth: 125, slnt: -7 } },
      { text: "D", axes: { wdth: 110, slnt: -7 } },
    ]);
  });
  it("formats a prefix without losing characters", () => {
    const out = applyRangeFormat([{ text: "hello world" }], 0, 5, { bold: true });
    expect(text(out)).toBe("hello world");
    expect(out[0]).toEqual({ text: "hello", bold: true });
    expect(out[1]).toEqual({ text: " world" });
  });

  it("formats a span across a run boundary, merging like neighbours", () => {
    const out = applyRangeFormat([{ text: "AB" }, { text: "CD" }], 1, 3, { bold: true });
    expect(text(out)).toBe("ABCD");
    expect(out).toEqual([{ text: "A" }, { text: "BC", bold: true }, { text: "D" }]);
  });

  it("does not split a surrogate pair (emoji stays intact)", () => {
    // "😀" is two UTF-16 units, so [1,3) selects exactly the emoji.
    const out = applyRangeFormat([{ text: "a😀b" }], 1, 3, { italic: true });
    expect(text(out)).toBe("a😀b");
    expect(out).toEqual([{ text: "a" }, { text: "😀", italic: true }, { text: "b" }]);
  });

  it("clears an attribute without leaving an undefined key that stops like runs merging", () => {
    // B/I clears the run's named face; an explicit `face: undefined` left behind
    // reads as null in the merge key, so the edited "AB" never rejoins "CD".
    const out = applyRangeFormat([{ text: "AB", bold: true, face: "Helvetica-Bold" }, { text: "CD", bold: false }], 0, 2, { bold: false });
    expect(out).toStrictEqual([{ text: "ABCD", bold: false }]);
  });

  it("is a no-op for an empty or inverted range", () => {
    const runs = [{ text: "abc" }];
    expect(applyRangeFormat(runs, 3, 3, { bold: true })).toBe(runs);
    expect(applyRangeFormat(runs, 2, 1, { bold: true })).toBe(runs);
  });
});

describe("setText", () => {
  it("returns the same spec when the text is unchanged", () => {
    const s = defaultSpec("abc");
    expect(setText(s, "abc")).toBe(s);
  });

  it("appends, inheriting the trailing run's style", () => {
    const out = setText(defaultSpec("ab"), "abc");
    expect(fullText(out)).toBe("abc");
  });

  it("preserves formatting outside the splice and caret-inherits the insert", () => {
    const s = defaultSpec();
    s.runs = [{ text: "AB", bold: true }, { text: "CD" }];
    const out = setText(s, "ABXCD"); // insert "X" after the bold "AB"
    expect(fullText(out)).toBe("ABXCD");
    expect(out.runs).toEqual([{ text: "ABX", bold: true }, { text: "CD" }]);
  });

  it("deletes a middle range", () => {
    const out = setText(defaultSpec("abcde"), "ae");
    expect(fullText(out)).toBe("ae");
  });

  it("keeps a styled tail when the head is deleted", () => {
    const s = defaultSpec();
    s.runs = [{ text: "abc" }, { text: "XYZ", bold: true }];
    const out = setText(s, "XYZ"); // delete the unstyled head
    expect(fullText(out)).toBe("XYZ");
    expect(out.runs).toEqual([{ text: "XYZ", bold: true }]);
  });
});

describe("resolveStyle", () => {
  it("merges a run over the layer defaults", () => {
    const st = resolveStyle(defaultSpec(), { text: "x", bold: true });
    expect(st.bold).toBe(true);
    expect(st.size).toBe(64); // from the spec default
    expect(st.italic).toBe(false);
    expect(st.fauxBold).toBe(false);
    expect(st.kerning).toBe("metrics");
  });

  it("lets runs override the layer kerning mode", () => {
    const st = resolveStyle(defaultSpec("AV", { kerning: "optical" }), { text: "AV", kerning: "none" });
    expect(st.kerning).toBe("none");
  });
});

describe("defaultSpec", () => {
  it("defaults editable type to left-to-right paragraph direction", () => {
    expect(defaultSpec().direction).toBe("ltr");
    expect(defaultSpec("rtl", { direction: "rtl" }).direction).toBe("rtl");
  });

  it("defaults editable type to the Latin composer while preserving World-Ready overrides", () => {
    expect(defaultSpec().composer).toBe("latin");
    expect(defaultSpec("bidi", { composer: "worldReady" }).composer).toBe("worldReady");
  });

  it("defaults Middle Eastern controls to neutral values", () => {
    const s = defaultSpec();
    expect(s.kashida).toBe("none");
    expect(s.diacriticX).toBe(0);
    expect(s.diacriticY).toBe(0);
  });
});

describe("subDigit (Type ▸ Language Options digits)", () => {
  it("leaves digits untouched for latin / undefined", async () => {
    const { subDigit } = await import("./raster");
    expect(subDigit("5")).toBe("5");
    expect(subDigit("5", "latin")).toBe("5");
    expect(subDigit("a", "arabic")).toBe("a"); // non-digits pass through
  });
  it("maps ASCII digits to Arabic-Indic and Eastern-Arabic glyphs", async () => {
    const { subDigit } = await import("./raster");
    expect(subDigit("0", "arabic")).toBe("٠");
    expect(subDigit("9", "arabic")).toBe("٩");
    expect(subDigit("0", "hindi")).toBe("۰");
    expect(subDigit("9", "hindi")).toBe("۹");
  });
});

describe("Middle Eastern type helpers", () => {
  it("inserts Kashidas only between Arabic connecting letters", async () => {
    const { applyKashidas } = await import("./raster");
    expect(applyKashidas("سلام", "none")).toBe("سلام");
    expect(applyKashidas("سلام", "short")).toContain("ـ");
    expect((applyKashidas("سلام", "long").match(/ـ/g) ?? []).length)
      .toBeGreaterThan((applyKashidas("سلام", "short").match(/ـ/g) ?? []).length);
    expect(applyKashidas("ABC", "long")).toBe("ABC");
  });

  it("splits Arabic combining marks from the base glyph", async () => {
    const { splitDiacritics, isArabicDiacritic } = await import("./raster");
    expect(isArabicDiacritic("\u064E")).toBe(true);
    expect(splitDiacritics("ب\u064E")).toEqual({ base: "ب", marks: "\u064E" });
    expect(splitDiacritics("A")).toEqual({ base: "A", marks: "" });
  });
});

describe("World-Ready Composer bidi helpers", () => {
  it("classifies strong Latin and Middle Eastern text directions", async () => {
    const { bidiClassForText } = await import("./raster");
    expect(bidiClassForText("ABC")).toBe("ltr");
    expect(bidiClassForText("אבג")).toBe("rtl");
    expect(bidiClassForText("سلام")).toBe("rtl");
    expect(bidiClassForText("  - ")).toBe("neutral");
  });

  it("reorders RTL runs visually without changing Latin composer behavior", async () => {
    const { worldReadyVisualText } = await import("./raster");
    expect(worldReadyVisualText("AאבB", "ltr")).toBe("AבאB");
    expect(worldReadyVisualText("AB אב CD", "ltr")).toBe("AB בא CD");
    expect(worldReadyVisualText("AB אב CD", "rtl")).toBe("CD בא AB");
  });
});

describe("text-on-path geometry", () => {
  it("walks a horizontal path with zero tangent angle", async () => {
    const { pathMetrics, pointAt } = await import("./raster");
    const m = pathMetrics([0, 0, 100, 0]);
    expect(m.len).toBe(100);
    const p = pointAt(m, 50);
    expect(p.x).toBeCloseTo(50); expect(p.y).toBeCloseTo(0); expect(p.angle).toBeCloseTo(0);
  });
  it("walks a vertical path with a 90° tangent", async () => {
    const { pathMetrics, pointAt } = await import("./raster");
    const m = pathMetrics([10, 0, 10, 80]);
    const p = pointAt(m, 40);
    expect(p.x).toBeCloseTo(10); expect(p.y).toBeCloseTo(40);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
  });
  it("crosses an L-shaped polyline into the second segment", async () => {
    const { pathMetrics, pointAt } = await import("./raster");
    const m = pathMetrics([0, 0, 100, 0, 100, 100]); // right then down
    expect(m.len).toBe(200);
    const p = pointAt(m, 150); // 50 into the downward segment
    expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(50);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
  });
  it("clamps past the end to the final point", async () => {
    const { pathMetrics, pointAt } = await import("./raster");
    const m = pathMetrics([0, 0, 10, 0]);
    const p = pointAt(m, 999);
    expect(p.x).toBeCloseTo(10);
  });
});

describe("applyOpenType", () => {
  it("substitutes standard ligatures (longest first)", async () => {
    const { applyOpenType } = await import("./raster");
    expect(applyOpenType("office flag", { liga: true } as never)).toBe("oﬃce ﬂag");
    expect(applyOpenType("fi fl ff", { liga: true } as never)).toBe("ﬁ ﬂ ﬀ");
    expect(applyOpenType("fi fl", {} as never)).toBe("fi fl"); // off → unchanged
  });
  it("substitutes common fractions", async () => {
    const { applyOpenType } = await import("./raster");
    expect(applyOpenType("1/2 cup, 3/4 tsp", { frac: true } as never)).toBe("½ cup, ¾ tsp");
  });
  it("raises ordinal suffixes", async () => {
    const { applyOpenType } = await import("./raster");
    expect(applyOpenType("1st 2nd 3rd 4th", { ordn: true } as never)).toBe("1ˢᵗ 2ⁿᵈ 3ʳᵈ 4ᵗʰ");
  });
});

describe("graphemeClusters", () => {
  it("keeps combining marks and emoji ZWJ sequences as single layout clusters", async () => {
    const { graphemeClusters } = await import("./raster");
    expect(graphemeClusters("e\u0301")).toEqual(["e\u0301"]);
    expect(graphemeClusters("👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦"]);
    expect(graphemeClusters("A🇺🇸B")).toEqual(["A", "🇺🇸", "B"]);
  });
});

describe("antiAliasAlpha", () => {
  it("maps the Photoshop Windows anti-alias modes to deterministic coverage curves", async () => {
    const { antiAliasAlpha } = await import("./raster");
    expect(antiAliasAlpha(0.1, "windowslcd")).toBeLessThan(0.2);
    expect(antiAliasAlpha(0.5, "windowslcd")).toBeGreaterThan(antiAliasAlpha(0.5, "windows"));
    expect(antiAliasAlpha(0.9, "windows")).toBeLessThanOrEqual(1);
    expect(antiAliasAlpha(0.49, "none")).toBe(0);
    expect(antiAliasAlpha(0.5, "none")).toBe(1);
  });
});

describe("text kerning", () => {
  it("separates Metrics, Optical, and None kerning deltas", async () => {
    const { kerningDelta } = await import("./raster");
    expect(kerningDelta("A", "V", 80, "metrics", -7)).toBe(-7);
    expect(kerningDelta("A", "V", 80, "none", -7)).toBe(0);
    expect(kerningDelta("A", "V", 80, "optical", 0)).toBeLessThan(-1);
  });

  it("uses optical pair classes without touching neutral pairs or spaces", async () => {
    const { opticalKerningEm } = await import("./raster");
    expect(opticalKerningEm("T", "o")).toBeLessThan(0);
    expect(opticalKerningEm("A", "V")).toBeLessThan(0);
    expect(opticalKerningEm("H", "n")).toBe(0);
    expect(opticalKerningEm("T", " ")).toBe(0);
  });
});

describe("mergedFeatures", () => {
  it("is empty when nothing is enabled", () => {
    expect(mergedFeatures(defaultSpec("x"))).toBe("");
  });

  it("serializes enabled layer features as a sorted CSS value", () => {
    const spec = defaultSpec("x", { features: { ss01: true, salt: true } });
    expect(mergedFeatures(spec)).toBe('"salt" 1, "ss01" 1');
  });

  it("merges run overrides over the layer defaults", () => {
    const spec = defaultSpec("x", { features: { ss01: true, salt: true } });
    const run: TextRun = { text: "x", features: { salt: false, ss05: true } };
    expect(mergedFeatures(spec, run)).toBe('"salt" 0, "ss01" 1, "ss05" 1');
  });

  it("folds the four legacy booleans in as their real OpenType tags", () => {
    const spec = defaultSpec("x", { liga: true, ordn: true });
    expect(mergedFeatures(spec)).toBe('"liga" 1, "ordn" 1');
  });

  it("lets an explicit feature override a legacy boolean of the same tag", () => {
    const spec = defaultSpec("x", { liga: true, features: { liga: false } });
    expect(mergedFeatures(spec)).toBe('"liga" 0');
  });
});

describe("native font discovery", () => {
  it("matches quoted families and CSS stacks by their concrete first family", () => {
    expect(fontFamilyKey('"Bodoni 72", serif')).toBe("bodoni 72");
    expect(fontFamilyKey("Bodoni 72")).toBe("bodoni 72");
  });

  it("adds safe unique families to the existing picker array", () => {
    const before = FONTS.slice();
    try {
      expect(addDiscoveredFonts(["Bodoni 72", "Arial", "Bad\0Name"])).toBe(true);
      expect(FONTS).toContain('"Bodoni 72"');
      expect(FONTS).toContain('"Bad Name"');
      expect(FONTS.filter((font) => font.split(",", 1)[0].toLowerCase() === "arial")).toHaveLength(1);
      expect(addDiscoveredFonts(["Bodoni 72"])).toBe(false);
    } finally {
      FONTS.splice(0, FONTS.length, ...before);
    }
  });

  it("keeps the built-in default stable when discovered families sort first", () => {
    const before = FONTS.slice();
    const defaultFont = defaultSpec().font;
    try {
      expect(addDiscoveredFonts(["Aardvark Display", "ZZZ Display"])).toBe(true);
      expect(FONTS[0]).toBe(defaultFont);
      expect(defaultSpec().font).toBe(defaultFont);
    } finally {
      FONTS.splice(0, FONTS.length, ...before);
    }
  });
});
