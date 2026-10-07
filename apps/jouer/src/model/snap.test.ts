import { describe, expect, it } from "vitest";
import { snapToGrid, snapPointToGrid, snapValue } from "./snap";

describe("snapToGrid", () => {
  it("rounds to the nearest multiple of the grid", () => {
    expect(snapToGrid(107, 10)).toBe(110);
    expect(snapToGrid(53, 10)).toBe(50);
    expect(snapToGrid(100, 16)).toBe(96); // round(6.25) → 6 × 16
    expect(snapToGrid(104, 16)).toBe(112); // round(6.5) → 7 × 16
  });

  it("leaves exact multiples untouched", () => {
    expect(snapToGrid(128, 16)).toBe(128);
    expect(snapToGrid(0, 16)).toBe(0);
    expect(snapToGrid(50, 10)).toBe(50);
  });

  it("snaps negative values symmetrically", () => {
    expect(snapToGrid(-107, 10)).toBe(-110);
    expect(snapToGrid(-53, 10)).toBe(-50);
  });

  it("passes the value through when the grid is off (< 1)", () => {
    expect(snapToGrid(107.3, 0)).toBe(107.3);
    expect(snapToGrid(107.3, 0.5)).toBe(107.3);
  });

  // Rotation snap (Unity "Grid and Snap → Rotate") reuses snapToGrid for degrees.
  it("rounds angles to the nearest rotation-snap increment (degrees)", () => {
    expect(snapToGrid(100, 15)).toBe(105); // round(6.67) → 7 × 15
    expect(snapToGrid(100, 90)).toBe(90); // round(1.11) → 1 × 90
    expect(snapToGrid(50, 30)).toBe(60); // round(1.67) → 2 × 30
    expect(snapToGrid(-100, 45)).toBe(-90); // round(-2.22) → -2 × 45
  });
});

// Scale snap (Unity "Grid and Snap → Scale") rounds to fractional steps, which
// snapToGrid's `< 1 → off` floor would wrongly pass through — hence snapValue.
describe("snapValue", () => {
  it("rounds to the nearest multiple of a fractional step", () => {
    expect(snapValue(1.37, 0.25)).toBe(1.25); // round(5.48) → 5 × 0.25
    expect(snapValue(2.6, 0.5)).toBe(2.5); // round(5.2) → 5 × 0.5
    expect(snapValue(1.4, 0.5)).toBe(1.5); // round(2.8) → 3 × 0.5
  });

  it("rounds to whole-number steps too", () => {
    expect(snapValue(107, 10)).toBe(110);
    expect(snapValue(3, 2)).toBe(4);
  });

  it("passes the value through when the step is non-positive", () => {
    expect(snapValue(1.37, 0)).toBe(1.37);
    expect(snapValue(1.37, -0.5)).toBe(1.37);
  });
});

describe("snapPointToGrid", () => {
  it("snaps both axes independently", () => {
    expect(snapPointToGrid({ x: 107, y: 53 }, 10)).toEqual({ x: 110, y: 50 });
  });

  it("is a no-op when the grid is off", () => {
    expect(snapPointToGrid({ x: 1.2, y: 3.4 }, 0)).toEqual({ x: 1.2, y: 3.4 });
  });
});
