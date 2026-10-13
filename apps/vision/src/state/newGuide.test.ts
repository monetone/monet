// Unit tests for the New Guide helpers. Engine-free (node); the dialog + guide
// rendering are covered by e2e/new-guide.spec.ts.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_GUIDE_COLOR,
  MAX_PERSISTED_GUIDES,
  clampGuidePos,
  cloneGuides,
  defaultGuidePos,
  normalizeGuides,
  parseGuidePosition,
  type Guide,
} from "./newGuide";

describe("defaultGuidePos", () => {
  it("centres a vertical guide on the width and a horizontal on the height", () => {
    expect(defaultGuidePos("v", 800, 600)).toBe(400);
    expect(defaultGuidePos("h", 800, 600)).toBe(300);
  });

  it("rounds the centre of an odd dimension", () => {
    expect(defaultGuidePos("v", 101, 100)).toBe(51); // round(50.5)
    expect(defaultGuidePos("h", 100, 101)).toBe(51);
  });
});

describe("clampGuidePos", () => {
  it("rounds an in-range position", () => {
    expect(clampGuidePos("v", 123.4, 800, 600)).toBe(123);
    expect(clampGuidePos("h", 123.6, 800, 600)).toBe(124);
  });

  it("clamps a negative position to 0", () => {
    expect(clampGuidePos("v", -50, 800, 600)).toBe(0);
  });

  it("clamps past the right edge to the width for a vertical guide", () => {
    expect(clampGuidePos("v", 9999, 800, 600)).toBe(800);
  });

  it("clamps past the bottom edge to the height for a horizontal guide", () => {
    expect(clampGuidePos("h", 9999, 800, 600)).toBe(600);
  });

  it("treats a non-finite position as 0", () => {
    expect(clampGuidePos("v", NaN, 800, 600)).toBe(0);
    expect(clampGuidePos("h", Infinity, 800, 600)).toBe(0); // Infinity is non-finite → 0 guard
  });
});

describe("parseGuidePosition", () => {
  it("uses the selected orientation's axis for percentages", () => {
    expect(parseGuidePosition("50%", "v", 400, 300, 72)).toBe(200);
    expect(parseGuidePosition("25 %", "h", 400, 300, 72)).toBe(75);
  });

  it("converts physical units using the document resolution", () => {
    expect(parseGuidePosition("1 in", "v", 400, 300, 300)).toBe(300);
    expect(parseGuidePosition("2.54cm", "h", 400, 300, 300)).toBeCloseTo(300);
    expect(parseGuidePosition("25.4 MM", "h", 400, 300, 300)).toBeCloseTo(300);
    expect(parseGuidePosition("72pt", "v", 400, 300, 300)).toBeCloseTo(300);
    expect(parseGuidePosition("6pc", "v", 400, 300, 300)).toBeCloseTo(300);
  });

  it("treats bare values as pixels and rejects malformed units", () => {
    expect(parseGuidePosition("123.5", "v", 400, 300, 72)).toBe(123.5);
    expect(parseGuidePosition("123.5 px", "v", 400, 300, 72)).toBe(123.5);
    expect(parseGuidePosition("", "v", 400, 300, 72)).toBeNull();
    expect(parseGuidePosition("12 bananas", "v", 400, 300, 72)).toBeNull();
    expect(parseGuidePosition("Infinity px", "v", 400, 300, 72)).toBeNull();
  });

  it("rejects a finite amount that overflows to Infinity after conversion", () => {
    expect(parseGuidePosition("9".repeat(308) + "%", "v", 400, 300, 72)).toBeNull();
    expect(parseGuidePosition("9".repeat(308) + " in", "v", 400, 300, 72)).toBeNull();
  });
});

describe("normalizeGuides", () => {
  it("keeps signed off-canvas positions when runtime or saved guides have no canvas bounds", () => {
    const guides: Guide[] = [
      { o: "v", p: 700, color: "#33aaff" },
      { o: "h", p: -50, color: "#ff0000" },
    ];
    expect(normalizeGuides(guides)).toEqual(guides);
    expect(cloneGuides(guides)).toEqual(guides);
    expect(normalizeGuides(guides, 400, 300)).toEqual([
      { ...guides[0], p: 400 }, { ...guides[1], p: 0 },
    ]);
  });

  it("normalizes positions and colors while rejecting malformed guides", () => {
    expect(normalizeGuides([
      { o: "v", p: 123.6, color: "#AABBCC" },
      { o: "h", p: -10, color: "blue" },
      { o: "v", p: 9999 },
      { o: "diagonal", p: 20, color: "#123456" },
      { o: "h", p: Number.POSITIVE_INFINITY, color: "#123456" },
    ], 800, 600)).toEqual([
      { o: "v", p: 124, color: "#aabbcc" },
      { o: "h", p: 0, color: DEFAULT_GUIDE_COLOR },
      { o: "v", p: 800, color: DEFAULT_GUIDE_COLOR },
    ]);
  });

  it("bounds untrusted arrays and clones accepted guides", () => {
    const source: Guide[] = Array.from({ length: MAX_PERSISTED_GUIDES + 1 }, (_, p) => ({
      o: "v",
      p,
      color: DEFAULT_GUIDE_COLOR,
    }));
    const cloned = cloneGuides(source);

    expect(cloned).toHaveLength(MAX_PERSISTED_GUIDES);
    expect(cloned).toEqual(source.slice(0, MAX_PERSISTED_GUIDES));
    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);
  });
});
