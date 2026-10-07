// Unit tests for the Color-panel spectrum ramp. Engine-free (node); the strip +
// click-to-pick are covered by e2e/color-ramp.spec.ts.
import { describe, it, expect } from "vitest";
import { rampColorAt, rampColor, RAMP_MODES } from "./colorRamp";

describe("rampColorAt", () => {
  it("maps the endpoints and midpoint to rainbow hues", () => {
    expect(rampColorAt(0)).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(rampColorAt(0.5)).toEqual({ h: 180, s: 1, v: 1, a: 1 });
    expect(rampColorAt(1)).toEqual({ h: 360, s: 1, v: 1, a: 1 });
  });

  it("rounds intermediate positions to a whole hue", () => {
    expect(rampColorAt(0.25).h).toBe(90);
    expect(rampColorAt(0.1).h).toBe(36);
  });

  it("clamps positions outside [0,1] to the ends", () => {
    expect(rampColorAt(-0.2)).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(rampColorAt(1.5)).toEqual({ h: 360, s: 1, v: 1, a: 1 });
  });
});

describe("rampColor (modes)", () => {
  const fg = { h: 0, s: 1, v: 1, a: 1 };
  const bg = { h: 240, s: 1, v: 1, a: 1 };

  it("Spectrum delegates to the rainbow ramp (ignores fg/bg)", () => {
    expect(rampColor("spectrum", 0.5, fg, bg)).toEqual({ h: 180, s: 1, v: 1, a: 1 });
  });

  it("Grayscale runs black→white", () => {
    expect(rampColor("grayscale", 0, fg, bg)).toEqual({ h: 0, s: 0, v: 0, a: 1 });
    expect(rampColor("grayscale", 0.5, fg, bg)).toEqual({ h: 0, s: 0, v: 0.5, a: 1 });
    expect(rampColor("grayscale", 1, fg, bg)).toEqual({ h: 0, s: 0, v: 1, a: 1 });
  });

  it("Current Colors lerps foreground→background", () => {
    expect(rampColor("current", 0, fg, bg)).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(rampColor("current", 1, fg, bg)).toEqual({ h: 240, s: 1, v: 1, a: 1 });
    expect(rampColor("current", 0.5, fg, bg)).toEqual({ h: 120, s: 1, v: 1, a: 1 });
    // mixed s/v lerp, rounded to 2dp
    expect(rampColor("current", 0.5, { h: 0, s: 1, v: 1, a: 1 }, { h: 0, s: 0.5, v: 0.8, a: 1 })).toEqual({ h: 0, s: 0.75, v: 0.9, a: 1 });
  });

  it("clamps fractions outside [0,1]", () => {
    expect(rampColor("grayscale", -0.2, fg, bg).v).toBe(0);
    expect(rampColor("grayscale", 1.5, fg, bg).v).toBe(1);
  });

  it("lists Spectrum first", () => {
    expect(RAMP_MODES[0].value).toBe("spectrum");
  });
});
