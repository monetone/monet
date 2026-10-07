// ─────────────────────────────────────────────────────────────
// analysis/zero-crossings.test — Audition Edit ▸ Zero Crossings parity
// ─────────────────────────────────────────────────────────────
// Hand-built sign patterns give exact, recomputable crossing indices.

import { describe, expect, it } from "vitest";
import { adjustRangeToZeroCrossings, nearestZeroCrossing } from "./zero-crossings";

// Crossings (between i-1 and i) are at indices 2 (1→-1) and 4 (-1→1).
const SIG = new Float32Array([1, 1, -1, -1, 1, 1]);

describe("nearestZeroCrossing", () => {
  it("finds the next crossing searching later (+1), including the start", () => {
    expect(nearestZeroCrossing(SIG, 0, 1)).toBe(2);
    expect(nearestZeroCrossing(SIG, 2, 1)).toBe(2); // already on a crossing → stays
    expect(nearestZeroCrossing(SIG, 3, 1)).toBe(4);
  });

  it("finds the previous crossing searching earlier (-1)", () => {
    expect(nearestZeroCrossing(SIG, 5, -1)).toBe(4);
    expect(nearestZeroCrossing(SIG, 3, -1)).toBe(2);
  });

  it("finds the nearest crossing either way (0), ties resolving to the earlier one", () => {
    expect(nearestZeroCrossing(SIG, 3, 0)).toBe(2); // |3-2| == |4-3| → earlier
    expect(nearestZeroCrossing(SIG, 4, 0)).toBe(4);
  });

  it("treats a sample exactly on zero as a crossing", () => {
    expect(nearestZeroCrossing(new Float32Array([1, 0, 1]), 0, 1)).toBe(1);
  });

  it("returns the clamped start when no crossing exists in that direction", () => {
    expect(nearestZeroCrossing(new Float32Array([1, 1, 1]), 1, 1)).toBe(1);
    expect(nearestZeroCrossing(new Float32Array([1, 1, 1]), 2, -1)).toBe(2);
  });
});

describe("adjustRangeToZeroCrossings", () => {
  it("pulls both edges inward to the enclosed crossings", () => {
    // sr = 1 so index == seconds; 1..5 → 2..4
    expect(adjustRangeToZeroCrossings(SIG, 1, { start: 1, end: 5 }, "inward")).toEqual({ start: 2, end: 4 });
  });

  it("pushes both edges outward to the surrounding crossings", () => {
    // crossings at 1,2,5,6; a flat 3..4 grows outward to 2..5
    const sig = new Float32Array([1, -1, 1, 1, 1, -1, 1]);
    expect(adjustRangeToZeroCrossings(sig, 1, { start: 3, end: 4 }, "outward")).toEqual({ start: 2, end: 5 });
  });

  it("leaves the range unchanged when an inward snap would collapse it", () => {
    const sig = new Float32Array([1, -1, 1, 1, 1, -1, 1]); // no crossing strictly inside 3..4
    expect(adjustRangeToZeroCrossings(sig, 1, { start: 3, end: 4 }, "inward")).toEqual({ start: 3, end: 4 });
  });

  it("converts seconds via the sample rate", () => {
    // SIG at sr=100: crossings at index 2 (0.02s) and 4 (0.04s); 0.01..0.05 inward → 0.02..0.04
    const r = adjustRangeToZeroCrossings(SIG, 100, { start: 0.01, end: 0.05 }, "inward");
    expect(r.start).toBeCloseTo(0.02, 9);
    expect(r.end).toBeCloseTo(0.04, 9);
  });

  it("snaps to true zero crossings of a sine (edges land near zero amplitude)", () => {
    const sr = 8000;
    const f = 100; // zero crossings every 1/200 s
    const sine = new Float32Array(sr); // 1 s
    for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * f * i) / sr);
    const r = adjustRangeToZeroCrossings(sine, sr, { start: 0.123, end: 0.187 }, "inward");
    // the crossing index is the first sample past zero, so |amp| ≤ sin(2π·f/sr) ≈ 0.078
    const at = (t: number) => Math.abs(sine[Math.round(t * sr)]);
    expect(at(r.start)).toBeLessThan(0.09);
    expect(at(r.end)).toBeLessThan(0.09);
    expect(r.start).toBeGreaterThan(0.123); // inward shrank the range
    expect(r.end).toBeLessThan(0.187);
  });
});
