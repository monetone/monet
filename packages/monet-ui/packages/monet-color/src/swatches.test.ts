// Unit tests for the Swatches panel's pure list helpers. Engine-free (node); the
// panel interactions are covered by e2e/swatches.spec.ts.
import { describe, it, expect } from "vitest";
import { DEFAULT_SWATCHES, normalizeSwatchHex, parseSwatches, addSwatchTo, removeSwatchAt } from "./swatches";

describe("normalizeSwatchHex", () => {
  it("lowercases, adds a leading #, and expands #rgb", () => {
    expect(normalizeSwatchHex("#FF0000")).toBe("#ff0000");
    expect(normalizeSwatchHex("00FF00")).toBe("#00ff00"); // no leading #
    expect(normalizeSwatchHex("#abc")).toBe("#aabbcc"); // shorthand
    expect(normalizeSwatchHex("  #123456  ")).toBe("#123456"); // trims
  });
});

describe("parseSwatches", () => {
  it("accepts empty libraries, normalizes and deduplicates entries, and rejects malformed data", () => {
    expect(parseSwatches("[]")).toEqual([]);
    expect(parseSwatches('["ABC", "#aabbcc", "#123456"]')).toEqual(["#aabbcc", "#123456"]);
    expect(parseSwatches(null)).toBeNull();
    expect(parseSwatches("not json")).toBeNull();
    expect(parseSwatches('["#12345g"]')).toBeNull();
    expect(parseSwatches('["#123456", 7]')).toBeNull();
  });
});

describe("addSwatchTo", () => {
  it("appends a normalized swatch", () => {
    expect(addSwatchTo(["#000000"], "#FFFFFF")).toEqual(["#000000", "#ffffff"]);
  });
  it("ignores a duplicate (same-ref no-op, case/shorthand-insensitive)", () => {
    const list = ["#ff0000"];
    expect(addSwatchTo(list, "#FF0000")).toBe(list);
    expect(addSwatchTo(list, "#f00")).toBe(list); // shorthand normalizes to the same
  });
});

describe("removeSwatchAt", () => {
  it("removes the indexed swatch; out-of-range is a same-ref no-op", () => {
    const list = ["#000000", "#ffffff", "#ff0000"];
    expect(removeSwatchAt(list, 1)).toEqual(["#000000", "#ff0000"]);
    expect(removeSwatchAt(list, 9)).toBe(list);
    expect(removeSwatchAt(list, -1)).toBe(list);
  });
});

describe("DEFAULT_SWATCHES", () => {
  it("is a non-empty palette of normalized hex strings", () => {
    expect(DEFAULT_SWATCHES.length).toBeGreaterThan(0);
    for (const h of DEFAULT_SWATCHES) expect(h).toBe(normalizeSwatchHex(h));
  });
});
