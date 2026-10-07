import { describe, it, expect } from "vitest";
import { clampSmoothing, smoothStrokePoint } from "./brushSmoothing";

describe("clampSmoothing", () => {
  it("passes 0..1 through and clamps out-of-range / non-finite", () => {
    expect(clampSmoothing(0)).toBe(0);
    expect(clampSmoothing(0.4)).toBe(0.4);
    expect(clampSmoothing(1)).toBe(1);
    expect(clampSmoothing(-1)).toBe(0);
    expect(clampSmoothing(2)).toBe(1);
    expect(clampSmoothing(NaN)).toBe(0);
    expect(clampSmoothing(Infinity)).toBe(1);
  });
});

describe("smoothStrokePoint", () => {
  it("smoothing 0 returns the cursor exactly (byte-identical strokes)", () => {
    expect(smoothStrokePoint({ x: 3, y: 7 }, { x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
  });
  it("smoothing 1 eases 10% from prev toward the target", () => {
    const p = smoothStrokePoint({ x: 0, y: 0 }, { x: 10, y: 100 }, 1);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(10, 6);
  });
  it("a mid value eases proportionally", () => {
    // f = 1 - 0.5*0.9 = 0.55
    const p = smoothStrokePoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    expect(p.x).toBeCloseTo(55, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
  it("repeated application lags toward a fixed target without overshooting", () => {
    const target = { x: 100, y: 0 };
    let p = { x: 0, y: 0 };
    let last = -1;
    for (let i = 0; i < 30; i++) {
      p = smoothStrokePoint(p, target, 0.8);
      expect(p.x).toBeGreaterThan(last); // monotonically approaches (lag)
      expect(p.x).toBeLessThanOrEqual(100); // never overshoots
      last = p.x;
    }
    expect(p.x).toBeGreaterThan(95); // and eventually catches up
  });
});
