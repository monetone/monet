import { describe, expect, it } from "vitest";
import { adjustedSkyColor, skyEdgePixels, skyGradientLine, skyGradientStops } from "./skyReplacement";

describe("skyReplacement helpers", () => {
  it("adjusts sky colours with brightness and temperature", () => {
    expect(adjustedSkyColor([100, 120, 180], 0.5, 0)[0]).toBeGreaterThan(100);
    const warm = adjustedSkyColor([100, 120, 180], 0, 0.5);
    expect(warm[0]).toBeGreaterThan(100);
    expect(warm[2]).toBeLessThan(180);
    const cool = adjustedSkyColor([100, 120, 180], 0, -0.5);
    expect(cool[0]).toBeLessThan(100);
    expect(cool[2]).toBeGreaterThan(180);
  });

  it("builds flipped normalized gradient stops with opacity", () => {
    const stops = Array.from(skyGradientStops({
      top: [0, 10, 20],
      bottom: [200, 210, 220],
      opacity: 0.4,
      flip: true,
    }));
    expect(stops[0]).toBe(0);
    expect(stops[1]).toBeCloseTo(200 / 255);
    expect(stops[2]).toBeCloseTo(210 / 255);
    expect(stops[3]).toBeCloseTo(220 / 255);
    expect(stops[4]).toBeCloseTo(0.4);
    expect(stops[5]).toBe(1);
    expect(stops[6]).toBe(0);
    expect(stops[7]).toBeCloseTo(10 / 255);
    expect(stops[8]).toBeCloseTo(20 / 255);
    expect(stops[9]).toBeCloseTo(0.4);
  });

  it("keeps the horizon at the same relative point while scaling the gradient", () => {
    const normal = skyGradientLine(1000, 0.45, 1);
    const zoomed = skyGradientLine(1000, 0.45, 2);
    expect(normal[1]).toBeCloseTo(0);
    expect(normal[3]).toBeCloseTo(1000);
    expect(zoomed[3] - zoomed[1]).toBeCloseTo(500);
    expect(zoomed[1] + (zoomed[3] - zoomed[1]) * 0.45).toBeCloseTo(450);
  });

  it("converts shift and fade percentages to document-relative pixels", () => {
    expect(skyEdgePixels(1000, 500, 0.5, 0.25)).toEqual({ shift: 20, fade: 10 });
    expect(skyEdgePixels(1000, 500, -0.5, 2)).toEqual({ shift: -20, fade: 40 });
  });
});
