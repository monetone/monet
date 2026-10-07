// Unit tests for the histogram statistics. Engine-free (node); the panel readout +
// EngineClient.channelHistogram() are covered by e2e/histogram-stats.spec.ts.
import { describe, it, expect } from "vitest";
import { histogramStats } from "./histogramStats";

/** A 256-bin histogram with `count` at `level`. */
function oneBin(level: number, count: number): number[] {
  const h = new Array(256).fill(0);
  h[level] = count;
  return h;
}

describe("histogramStats", () => {
  it("returns all zeros for an empty histogram", () => {
    expect(histogramStats(new Array(256).fill(0))).toEqual({ mean: 0, median: 0, stdDev: 0, pixels: 0 });
  });

  it("computes a single-bin histogram (uniform image)", () => {
    expect(histogramStats(oneBin(128, 100))).toEqual({ mean: 128, median: 128, stdDev: 0, pixels: 100 });
  });

  it("computes mean and spread for the two extremes", () => {
    const h = new Array(256).fill(0);
    h[0] = 1; h[255] = 1;
    const s = histogramStats(h);
    expect(s.mean).toBeCloseTo(127.5, 6);
    expect(s.stdDev).toBeCloseTo(127.5, 6);
    expect(s.pixels).toBe(2);
    expect(s.median).toBe(0); // first level reaching half the pixels
  });

  it("computes a uniform 0..255 ramp", () => {
    const h = new Array(256).fill(1);
    const s = histogramStats(h);
    expect(s.mean).toBeCloseTo(127.5, 6);
    expect(s.pixels).toBe(256);
    expect(s.median).toBe(127); // cumulative reaches 128 at level 127
  });
});
