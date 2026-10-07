// Unit tests for the Ruler ▸ Straighten angle. Engine-free (node); the options-bar
// button + rotation are covered by e2e/ruler-straighten.spec.ts.
import { describe, it, expect } from "vitest";
import { straightenAngle } from "./straighten";

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

describe("straightenAngle", () => {
  it("is 0 for an already-horizontal line", () => {
    expect(straightenAngle(100, 0)).toBe(0);
  });

  it("is 0 for an already-vertical line", () => {
    expect(straightenAngle(0, 100)).toBe(0);
  });

  it("is 0 for a zero-length line", () => {
    expect(straightenAngle(0, 0)).toBe(0);
  });

  it("counter-rotates a line tilted down-to-the-right", () => {
    // dy>0 is downward (y-down screen space): a 10° down-right tilt → rotate -10° (CCW)
    expect(straightenAngle(100, tan(10) * 100)).toBeCloseTo(-10, 4);
  });

  it("counter-rotates a line tilted up-to-the-right the other way", () => {
    expect(straightenAngle(100, -tan(10) * 100)).toBeCloseTo(10, 4);
  });

  it("snaps a near-vertical line to vertical (small rotation)", () => {
    // atan2(100,10) ≈ 84.29° → deviation from 90° is -5.71° → straighten +5.71°
    expect(straightenAngle(10, 100)).toBeCloseTo(5.71, 1);
  });

  it("keeps the result within [-45, 45] for any direction", () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const a = straightenAngle(Math.cos((deg * Math.PI) / 180) * 100, Math.sin((deg * Math.PI) / 180) * 100);
      expect(a).toBeGreaterThanOrEqual(-45);
      expect(a).toBeLessThanOrEqual(45);
    }
  });
});
