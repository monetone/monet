// Unit tests for the noise-gradient stop generator. Engine-free (node); the
// gradient tool applies the stops through the existing gradient_fill pipeline,
// covered by the noise-gradient e2e.
import { describe, it, expect } from "vitest";
import { noiseGradientStops } from "./noiseGradient";

describe("noiseGradientStops", () => {
  it("is deterministic for a given seed", () => {
    expect(noiseGradientStops(42, 0.5)).toEqual(noiseGradientStops(42, 0.5));
  });

  it("produces a different ramp for a different seed", () => {
    expect(noiseGradientStops(1, 0.7)).not.toEqual(noiseGradientStops(2, 0.7));
  });

  it("raises the band count with roughness", () => {
    expect(noiseGradientStops(3, 0).length).toBe(2); // smooth 2-colour blend
    expect(noiseGradientStops(3, 1).length).toBeGreaterThan(noiseGradientStops(3, 0.3).length);
  });

  it("emits well-formed stops (monotonic pos 0..1, rgba in range, endpoints pinned)", () => {
    const stops = noiseGradientStops(99, 0.8);
    expect(stops[0].pos).toBe(0);
    expect(stops[stops.length - 1].pos).toBe(1);
    let prev = -1;
    for (const s of stops) {
      expect(s.pos).toBeGreaterThanOrEqual(prev); // non-decreasing
      prev = s.pos;
      for (const c of [s.r, s.g, s.b, s.a]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });
});
