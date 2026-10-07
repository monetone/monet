// Unit tests for the histogram-readout helpers. Engine-free (node); the hover
// surface + cells are covered by e2e/histogram-readout.spec.ts.
import { describe, it, expect } from "vitest";
import { levelFromFraction, histogramReadout } from "./histogramReadout";

describe("levelFromFraction", () => {
  it("maps the ends and middle", () => {
    expect(levelFromFraction(0, 256)).toBe(0);
    expect(levelFromFraction(1, 256)).toBe(255);
    expect(levelFromFraction(0.5, 256)).toBe(128);
  });

  it("clamps out-of-range fractions", () => {
    expect(levelFromFraction(-1, 256)).toBe(0);
    expect(levelFromFraction(2, 256)).toBe(255);
  });
});

describe("histogramReadout", () => {
  const single = (() => { const c = new Array(256).fill(0); c[5] = 10; return c; })();
  const uniform = new Array(256).fill(1);
  const empty = new Array(256).fill(0);

  it("reports count + cumulative percentile for a single populated level", () => {
    expect(histogramReadout(single, 5)).toEqual({ level: 5, count: 10, percentile: 100 });
    expect(histogramReadout(single, 4)).toEqual({ level: 4, count: 0, percentile: 0 });
    expect(histogramReadout(single, 255)).toEqual({ level: 255, count: 0, percentile: 100 });
  });

  it("computes the cumulative percentile for a uniform histogram", () => {
    expect(histogramReadout(uniform, 127).percentile).toBe(50);
    expect(histogramReadout(uniform, 255).percentile).toBe(100);
  });

  it("returns percentile 0 when there are no pixels", () => {
    expect(histogramReadout(empty, 100)).toEqual({ level: 100, count: 0, percentile: 0 });
  });

  it("clamps the level into range", () => {
    expect(histogramReadout(single, -5).level).toBe(0);
    expect(histogramReadout(single, 999).level).toBe(255);
  });
});
