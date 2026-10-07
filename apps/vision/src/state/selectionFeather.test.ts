// Unit tests for the selection feather helpers. Engine-free (node); the options-bar
// input + canvas feather apply are covered by e2e/selection-feather.spec.ts.
import { describe, it, expect } from "vitest";
import { clampFeather, featherActive, supportsFeather } from "./selectionFeather";

describe("clampFeather", () => {
  it("clamps to [0, 1000]", () => {
    expect(clampFeather(-5)).toBe(0);
    expect(clampFeather(2000)).toBe(1000);
    expect(clampFeather(8)).toBe(8);
  });
  it("rounds fractional values", () => {
    expect(clampFeather(7.4)).toBe(7);
    expect(clampFeather(7.6)).toBe(8);
  });
  it("treats NaN as 0", () => {
    expect(clampFeather(NaN)).toBe(0);
  });
});

describe("featherActive", () => {
  it("is true only for radii >= 0.5", () => {
    expect(featherActive(0)).toBe(false);
    expect(featherActive(0.4)).toBe(false);
    expect(featherActive(0.5)).toBe(true);
    expect(featherActive(8)).toBe(true);
  });
});

describe("supportsFeather", () => {
  it("is true for the feather-capable selection tools", () => {
    for (const t of ["marquee", "ellipse", "lasso", "polylasso", "wand"]) {
      expect(supportsFeather(t)).toBe(true);
    }
  });
  it("is false for single row/column and non-selection tools", () => {
    for (const t of ["singlerow", "singlecolumn", "bucket", "move", "brush", "crop"]) {
      expect(supportsFeather(t)).toBe(false);
    }
  });
});
