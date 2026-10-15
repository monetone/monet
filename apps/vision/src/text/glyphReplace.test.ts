import { describe, expect, it } from "vitest";
import { glyphReplaceRange } from "./spec";

describe("glyphReplaceRange", () => {
  it("replaces only the character just inserted, while the caret is still collapsed on it", () => {
    expect(glyphReplaceRange("©", "©", [5, 5])).toEqual([4, 5]);
    expect(glyphReplaceRange("AB", "AB", [2, 2])).toEqual([0, 2]);
    expect(glyphReplaceRange("©", "©", [0, 0])).toEqual([0, 0]);
  });

  it("returns null for a selection, a different character, an empty insert, or no editor", () => {
    expect(glyphReplaceRange("©", "©", [4, 6])).toBeNull();
    expect(glyphReplaceRange("©", "®", [5, 5])).toBeNull();
    expect(glyphReplaceRange("©", "", [5, 5])).toBeNull();
    expect(glyphReplaceRange(null, "©", [5, 5])).toBeNull();
    expect(glyphReplaceRange("©", "©", null)).toBeNull();
  });
});
