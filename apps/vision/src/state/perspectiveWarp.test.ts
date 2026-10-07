// Unit tests for Perspective Warp's pure geometry. Engine-free (node); the
// engine homography + dialog are covered by e2e/perspective-warp.spec.ts.
import { describe, it, expect } from "vitest";
import { perspectiveWarpCoords, isIdentityWarp, ZERO_WARP_OFFSETS, type WarpOffset } from "./perspectiveWarp";

describe("perspectiveWarpCoords", () => {
  it("maps zero offsets to the identity rectangle (TL,TR,BR,BL)", () => {
    expect(perspectiveWarpCoords(ZERO_WARP_OFFSETS, 200, 100)).toEqual([0, 0, 200, 0, 200, 100, 0, 100]);
  });

  it("adds each corner offset as a percent of the canvas W/H", () => {
    const offsets: WarpOffset[] = [
      { dx: 10, dy: 0 },  // TL right 10% of 200 = +20 → (20, 0)
      { dx: 0, dy: 20 },  // TR down 20% of 100 = +20 → (200, 20)
      { dx: -25, dy: 0 }, // BR left 25% of 200 = -50 → (150, 100)
      { dx: 0, dy: -10 }, // BL up 10% of 100 = -10 → (0, 90)
    ];
    expect(perspectiveWarpCoords(offsets, 200, 100)).toEqual([20, 0, 200, 20, 150, 100, 0, 90]);
  });

  it("falls back to zero for missing corners (never NaN)", () => {
    expect(perspectiveWarpCoords([{ dx: 50, dy: 0 }], 100, 100)).toEqual([50, 0, 100, 0, 100, 100, 0, 100]);
  });
});

describe("isIdentityWarp", () => {
  it("is true only when every corner offset is zero", () => {
    expect(isIdentityWarp(ZERO_WARP_OFFSETS)).toBe(true);
    expect(isIdentityWarp([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 1, dy: 0 }])).toBe(false);
    expect(isIdentityWarp([{ dx: 0, dy: 0 }])).toBe(false); // wrong length
  });
});
