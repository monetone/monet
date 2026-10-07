import { describe, it, expect } from "vitest";
import { spotHealDabs } from "./spotHeal";

describe("spotHealDabs", () => {
  it("returns [] for no points", () => {
    expect(spotHealDabs([], 5)).toEqual([]);
    expect(spotHealDabs([3], 5)).toEqual([]); // odd/short → no complete point
  });

  it("maps a single dab to one Replace rect centred on the point", () => {
    expect(spotHealDabs([20, 12], 4)).toEqual([{ x: 16, y: 8, w: 8, h: 8, mode: 0 }]);
  });

  it("uses Replace for the first dab and Add for the rest", () => {
    const dabs = spotHealDabs([10, 10, 14, 10, 18, 10], 3);
    expect(dabs.map((d) => d.mode)).toEqual([0, 1, 1]);
    expect(dabs[0]).toEqual({ x: 7, y: 7, w: 6, h: 6, mode: 0 });
    expect(dabs[2]).toEqual({ x: 15, y: 7, w: 6, h: 6, mode: 1 });
  });

  it("clamps a sub-1 radius to 1 (diameter 2)", () => {
    expect(spotHealDabs([5, 5], 0)).toEqual([{ x: 4, y: 4, w: 2, h: 2, mode: 0 }]);
    expect(spotHealDabs([5, 5], 0.4)).toEqual([{ x: 4, y: 4, w: 2, h: 2, mode: 0 }]);
  });

  it("rounds fractional centres and radius", () => {
    // r = round(2.5) = 3 (diameter 6); x = round(10.6-3)=8, y = round(10.4-3)=7
    expect(spotHealDabs([10.6, 10.4], 2.5)).toEqual([{ x: 8, y: 7, w: 6, h: 6, mode: 0 }]);
  });
});
