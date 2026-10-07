// keywordEntry spec — LR keyword-entry delimiter parsing (finding 18): lists
// split into entries, hierarchy delimiters become "|"-joined root→leaf paths.

import { describe, expect, it } from "vitest";

import { parseKeywordEntry } from "./keywordEntry";

describe("parseKeywordEntry", () => {
  it("returns a single keyword unchanged", () => {
    expect(parseKeywordEntry("dog")).toEqual(["dog"]);
  });

  it("splits comma / semicolon list delimiters", () => {
    expect(parseKeywordEntry("dog, cat; bird")).toEqual(["dog", "cat", "bird"]);
  });

  it("joins | and > hierarchy delimiters into a root→leaf path", () => {
    expect(parseKeywordEntry("animal | dog")).toEqual(["animal|dog"]);
    expect(parseKeywordEntry("animal > dog")).toEqual(["animal|dog"]);
    expect(parseKeywordEntry("animal > dog > puppy")).toEqual(["animal|dog|puppy"]);
  });

  it("reverses a <-only entry (leaf < parent)", () => {
    expect(parseKeywordEntry("dog < animal")).toEqual(["animal|dog"]);
  });

  it("mixes list + hierarchy delimiters", () => {
    expect(parseKeywordEntry("landscape > mountains, sunset")).toEqual([
      "landscape|mountains",
      "sunset",
    ]);
  });

  it("trims whitespace and drops empty segments", () => {
    expect(parseKeywordEntry("  a , , b  ")).toEqual(["a", "b"]);
    expect(parseKeywordEntry(">>a<<")).toEqual(["a"]);
  });

  it("dedupes paths case-insensitively, keeping the first spelling", () => {
    expect(parseKeywordEntry("Dog, dog, DOG")).toEqual(["Dog"]);
    expect(parseKeywordEntry("Animal > Dog, animal > dog")).toEqual(["Animal|Dog"]);
  });

  it("returns an empty list for blank / delimiter-only input", () => {
    expect(parseKeywordEntry("")).toEqual([]);
    expect(parseKeywordEntry("  ,; | ")).toEqual([]);
  });
});
