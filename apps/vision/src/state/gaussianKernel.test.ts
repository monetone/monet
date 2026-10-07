// Unit tests for the Gaussian Blur kernel + 1-D convolution. Engine-free (node).
// These pin the kernel build (must match filters.rs gaussian_kernel) and the
// edge-clamped separable convolution pass.
import { describe, it, expect } from "vitest";
import { gaussianKernel, convolve1D } from "./gaussianKernel";

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

describe("gaussianKernel", () => {
  it("a radius ≤ 0 is the single-tap identity", () => {
    expect(gaussianKernel(0)).toEqual({ weights: [1], radius: 0 });
    expect(gaussianKernel(-5)).toEqual({ weights: [1], radius: 0 });
  });

  it("radius 2 (sigma 1) produces the expected normalised 5-tap kernel", () => {
    const k = gaussianKernel(2);
    expect(k.radius).toBe(2);
    expect(k.weights).toHaveLength(5);
    const want = [0.0544887, 0.2442013, 0.4026199, 0.2442013, 0.0544887];
    k.weights.forEach((w, i) => expect(w).toBeCloseTo(want[i], 6));
  });

  it("is normalised, symmetric, centre-peaked and monotonic for every radius", () => {
    for (const radius of [1, 2, 3, 5, 8, 12]) {
      const { weights, radius: r } = gaussianKernel(radius);
      expect(weights).toHaveLength(2 * r + 1);
      expect(sum(weights)).toBeCloseTo(1, 9); // normalised
      for (let i = 0; i < weights.length; i++) {
        expect(weights[i]).toBeCloseTo(weights[weights.length - 1 - i], 12); // symmetric
        expect(weights[i]).toBeGreaterThan(0);
      }
      // strictly increasing up to the centre, strictly decreasing after
      for (let i = 1; i <= r; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]);
        expect(weights[weights.length - 1 - i]).toBeGreaterThan(weights[weights.length - i]);
      }
      expect(Math.max(...weights)).toBe(weights[r]); // peak at centre
    }
  });

  it("uses sigma = radius/2 (NOT r/2) — pinned at a fractional radius", () => {
    // radius 1.5 → r = ceil(1.5) = 2 but sigma = max(1.5/2, 0.5) = 0.75 (not r/2 = 1).
    // These weights distinguish the two formulas; r/2 would give the radius-2 kernel.
    const k = gaussianKernel(1.5);
    expect(k.radius).toBe(2);
    const want = [0.0151996, 0.2187517, 0.5320973, 0.2187517, 0.0151996];
    k.weights.forEach((w, i) => expect(w).toBeCloseTo(want[i], 6));
  });

  it("a larger radius spreads the weight (flatter, smaller centre tap)", () => {
    expect(gaussianKernel(8).weights[8]).toBeLessThan(gaussianKernel(2).weights[2]);
  });

  it("sigma is floored at 0.5 for small radii", () => {
    // radius 0.5 → r = ceil(0.5) = 1, sigma = max(0.25, 0.5) = 0.5 → a 3-tap kernel.
    const k = gaussianKernel(0.5);
    expect(k.radius).toBe(1);
    expect(k.weights).toHaveLength(3);
    expect(sum(k.weights)).toBeCloseTo(1, 9);
  });
});

describe("convolve1D (one edge-clamped separable pass)", () => {
  it("leaves a constant signal unchanged (kernel sums to 1)", () => {
    const out = convolve1D([50, 50, 50, 50, 50], gaussianKernel(2));
    for (const v of out) expect(v).toBeCloseTo(50, 9);
  });

  it("the identity kernel returns the signal unchanged", () => {
    expect(convolve1D([10, 20, 30, 40], gaussianKernel(0))).toEqual([10, 20, 30, 40]);
  });

  it("spreads an interior impulse into the kernel shape, conserving its mass", () => {
    const signal = [0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0];
    const out = convolve1D(signal, gaussianKernel(2));
    const k = gaussianKernel(2).weights;
    // the impulse at index 5 spreads to 3..7 with the kernel weights × 255
    expect(out[5]).toBeCloseTo(255 * k[2], 6);
    expect(out[4]).toBeCloseTo(255 * k[1], 6);
    expect(out[6]).toBeCloseTo(255 * k[1], 6);
    expect(out[3]).toBeCloseTo(255 * k[0], 6);
    expect(out[7]).toBeCloseTo(255 * k[0], 6);
    expect(out[4]).toBeCloseTo(out[6], 12); // symmetric
    expect(sum(out)).toBeCloseTo(255, 6); // mass conserved
  });

  it("clamps at the edges (replicates the boundary)", () => {
    // at x=0 every tap (incl. the off-edge ones) lands in the solid-100 region → 100;
    // at x=5 every tap lands in the 0 region → 0.
    const out = convolve1D([100, 100, 100, 0, 0, 0], gaussianKernel(2));
    expect(out[0]).toBeCloseTo(100, 6);
    expect(out[5]).toBeCloseTo(0, 6);
    expect(out[0]).toBeGreaterThan(out[5]);
  });

  it("smooths a step edge monotonically (no overshoot)", () => {
    const out = convolve1D([0, 0, 0, 255, 255, 255], gaussianKernel(3));
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] - 1e-9);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255 + 1e-9);
    }
  });

  it("a kernel wider than the signal still preserves a constant (heavy edge clamp)", () => {
    // gaussianKernel(4) is 9 taps over a 3-element signal — every tap clamps in-range.
    for (const v of convolve1D([7, 7, 7], gaussianKernel(4))) expect(v).toBeCloseTo(7, 9);
  });

  it("an empty signal returns empty", () => {
    expect(convolve1D([], gaussianKernel(2))).toEqual([]);
  });

  it("is deterministic", () => {
    const k = gaussianKernel(4);
    expect(convolve1D([5, 90, 30, 200, 17], k)).toEqual(convolve1D([5, 90, 30, 200, 17], k));
  });
});

// ── Several radius fixtures swept for the kernel invariants ──────────────────
describe.each([1, 1.5, 2, 4, 6, 10, 20])("fixture: radius=%s", (radius) => {
  it("normalised, symmetric, all-positive weights", () => {
    const { weights, radius: r } = gaussianKernel(radius);
    expect(weights).toHaveLength(2 * r + 1);
    expect(sum(weights)).toBeCloseTo(1, 9);
    for (let i = 0; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThan(0);
      expect(weights[i]).toBeLessThanOrEqual(1);
      expect(weights[i]).toBeCloseTo(weights[weights.length - 1 - i], 12);
    }
  });
});
