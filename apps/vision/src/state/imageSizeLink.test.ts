// Unit tests for the Image Size Constrain-Proportions geometry. Engine-free (node);
// the dialog wiring is covered by e2e/image-size.spec.ts.
import { describe, it, expect } from "vitest";
import { linkedHeight, linkedWidth, resolveImageSize, toPercent } from "./imageSizeLink";

describe("linkedHeight", () => {
  it("preserves the origW:origH aspect", () => {
    expect(linkedHeight(600, 1000, 500)).toBe(300); // 2:1 → half width → half height
    expect(linkedHeight(50, 100, 100)).toBe(50); // square stays square
  });
  it("rounds to an integer", () => {
    expect(linkedHeight(333, 1000, 300)).toBe(100); // 333 * 0.3 = 99.9 → 100
  });
  it("clamps to >= 1 for tiny / zero inputs", () => {
    expect(linkedHeight(1, 1000, 500)).toBe(1); // 0.5 → 1
    expect(linkedHeight(0, 1000, 500)).toBe(1);
  });
  it("falls back to max(1, round(input)) when the source aspect is degenerate", () => {
    expect(linkedHeight(640, 0, 500)).toBe(640);
    expect(linkedHeight(640, 1000, 0)).toBe(640);
  });
});

describe("linkedWidth", () => {
  it("preserves the origW:origH aspect", () => {
    expect(linkedWidth(200, 1000, 500)).toBe(400); // 2:1 → height 200 → width 400
    expect(linkedWidth(50, 100, 100)).toBe(50);
  });
  it("rounds and clamps to >= 1", () => {
    expect(linkedWidth(99, 300, 1000)).toBe(30); // 99 * 0.3 = 29.7 → 30
    expect(linkedWidth(0, 1000, 500)).toBe(1);
  });
  it("falls back when the source aspect is degenerate", () => {
    expect(linkedWidth(480, 0, 500)).toBe(480);
    expect(linkedWidth(480, 1000, 0)).toBe(480);
  });
});

describe("resolveImageSize", () => {
  it("passes pixels through (rounded)", () => {
    expect(resolveImageSize(150, "px", 200)).toBe(150);
    expect(resolveImageSize(120.4, "px", 200)).toBe(120);
  });
  it("converts a percentage of the original to pixels", () => {
    expect(resolveImageSize(50, "percent", 200)).toBe(100);
    expect(resolveImageSize(25, "percent", 200)).toBe(50);
    expect(resolveImageSize(200, "percent", 200)).toBe(400);
  });
  it("clamps to at least 1 pixel", () => {
    expect(resolveImageSize(0.2, "percent", 200)).toBe(1);
  });
});

describe("toPercent", () => {
  it("reports the pixel size as a percentage of the original", () => {
    expect(toPercent(100, 200)).toBe(50);
    expect(toPercent(200, 200)).toBe(100);
    expect(toPercent(50, 200)).toBe(25);
  });
  it("guards a degenerate original and clamps to >= 1", () => {
    expect(toPercent(150, 0)).toBe(100);
    expect(toPercent(1, 1000)).toBe(1); // 0.1% → 1
  });
});
