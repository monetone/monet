import { describe, it, expect } from "vitest";
import {
  defaultPatternName, addPatternTo, removePatternAt, serializePatterns, parsePatterns,
  type PatternPreset,
} from "./patternPresets";

/** A tile whose texels are distinguishable per index, so a round trip that drops
 *  or reorders bytes shows up. */
const tile = (name: string, w = 2, h = 2): PatternPreset => ({
  name, w, h,
  px: Uint16Array.from({ length: w * h * 4 }, (_, i) => (i * 4097) & 0xffff),
});

describe("defaultPatternName", () => {
  it("numbers one past the highest existing Pattern N", () => {
    expect(defaultPatternName([])).toBe("Pattern 1");
    expect(defaultPatternName(["Pattern 1", "Pattern 3"])).toBe("Pattern 4");
  });
  it("ignores names that are not of that form", () => {
    expect(defaultPatternName(["Herringbone", "pattern 9", "Pattern 2x"])).toBe("Pattern 1");
  });
});

describe("library list ops", () => {
  it("appends and keeps earlier patterns — defining a second no longer destroys the first", () => {
    const a = tile("Pattern 1");
    const list = addPatternTo(addPatternTo([], a), tile("Pattern 2"));
    expect(list.map((p) => p.name)).toEqual(["Pattern 1", "Pattern 2"]);
    expect(list[0].px).toEqual(a.px);
  });
  it("is a same-ref no-op on a duplicate name or a bad remove index", () => {
    const list = [tile("Pattern 1")];
    expect(addPatternTo(list, tile("Pattern 1"))).toBe(list);
    expect(removePatternAt(list, 5)).toBe(list);
    expect(removePatternAt(list, -1)).toBe(list);
  });
  it("removes by index", () => {
    const list = [tile("Pattern 1"), tile("Pattern 2"), tile("Pattern 3")];
    expect(removePatternAt(list, 1).map((p) => p.name)).toEqual(["Pattern 1", "Pattern 3"]);
  });
});

describe("persistence", () => {
  it("round-trips names, dimensions and 16-bit texels", () => {
    const list = [tile("Pattern 1"), tile("Herringbone", 3, 5)];
    const back = parsePatterns(serializePatterns(list));
    expect(back).not.toBeNull();
    expect(back!.map((p) => [p.name, p.w, p.h])).toEqual([["Pattern 1", 2, 2], ["Herringbone", 3, 5]]);
    expect(back![0].px).toEqual(list[0].px);
    expect(back![1].px).toEqual(list[1].px);
  });

  it("returns null for a missing or non-library entry", () => {
    expect(parsePatterns(null)).toBeNull();
    expect(parsePatterns("")).toBeNull();
    expect(parsePatterns("{not json")).toBeNull();
    expect(parsePatterns('{"name":"Pattern 1"}')).toBeNull();
  });

  it("drops entries whose buffer does not match their dimensions", () => {
    // A short buffer would make the engine's set_pattern a silent no-op, so the
    // library must not hand one out.
    const good = tile("Pattern 1");
    const raw = JSON.parse(serializePatterns([good, tile("Pattern 2")])) as { w: number; h: number }[];
    raw[1].w = 4; // claims 4×2 while carrying 2×2 texels
    const back = parsePatterns(JSON.stringify(raw));
    expect(back!.map((p) => p.name)).toEqual(["Pattern 1"]);
  });

  it("drops entries with bad names, dimensions or base64", () => {
    const back = parsePatterns(JSON.stringify([
      { name: "  ", w: 2, h: 2, px: "AAAA" },
      { name: "Zero", w: 0, h: 2, px: "AAAA" },
      { name: "Huge", w: 999999, h: 999999, px: "AAAA" },
      { name: "Fractional", w: 2.5, h: 2, px: "AAAA" },
      { name: "Garbage", w: 2, h: 2, px: "not base64!!" },
      null,
      "nope",
    ]));
    expect(back).toEqual([]);
  });
});
