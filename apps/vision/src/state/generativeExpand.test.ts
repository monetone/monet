import { describe, it, expect } from "vitest";
import { expandGeometry } from "./generativeExpand";

describe("expandGeometry", () => {
  it("all sides grows both dims and centres the original", () => {
    expect(expandGeometry(100, 80, 20, "all")).toEqual({ nw: 140, nh: 120, dx: 20, dy: 20 });
  });
  it("horizontal grows width on both sides, keeps height", () => {
    expect(expandGeometry(100, 80, 30, "horizontal")).toEqual({ nw: 160, nh: 80, dx: 30, dy: 0 });
  });
  it("vertical grows height on both sides, keeps width", () => {
    expect(expandGeometry(100, 80, 10, "vertical")).toEqual({ nw: 100, nh: 100, dx: 0, dy: 10 });
  });
  it("right-only grows width and leaves the original at the origin", () => {
    expect(expandGeometry(100, 80, 30, "right")).toEqual({ nw: 130, nh: 80, dx: 0, dy: 0 });
  });
  it("left-only offsets the original rightward", () => {
    expect(expandGeometry(100, 80, 25, "left")).toEqual({ nw: 125, nh: 80, dx: 25, dy: 0 });
  });
  it("rounds and clamps a negative amount to zero growth", () => {
    expect(expandGeometry(100, 80, -5, "all")).toEqual({ nw: 100, nh: 80, dx: 0, dy: 0 });
  });
});
