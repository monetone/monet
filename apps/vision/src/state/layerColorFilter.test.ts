// Unit tests for the layer colour-filter helpers. Engine-free (node); the swatch
// row + list narrowing are covered by e2e/layer-color-filter.spec.ts.
import { describe, it, expect } from "vitest";
import { layerColorMatches, toggleColorFilter } from "./layerColorFilter";
import type { LayerLabel } from "./layerLabels";

describe("layerColorMatches", () => {
  it("passes every layer when no colour is selected", () => {
    expect(layerColorMatches("red", [])).toBe(true);
    expect(layerColorMatches(undefined, [])).toBe(true);
    expect(layerColorMatches("none", [])).toBe(true);
  });

  it("matches only layers carrying a selected colour", () => {
    expect(layerColorMatches("red", ["red"])).toBe(true);
    expect(layerColorMatches("red", ["red", "blue"])).toBe(true);
    expect(layerColorMatches("blue", ["red"])).toBe(false);
  });

  it("never matches unset/none against an active filter", () => {
    expect(layerColorMatches(undefined, ["red"])).toBe(false);
    expect(layerColorMatches("none", ["red"])).toBe(false);
  });
});

describe("toggleColorFilter", () => {
  it("adds a colour when absent", () => {
    expect(toggleColorFilter([], "red")).toEqual(["red"]);
    expect(toggleColorFilter(["red"], "blue")).toEqual(["red", "blue"]);
  });

  it("removes a colour when present", () => {
    expect(toggleColorFilter(["red", "blue"], "red")).toEqual(["blue"]);
  });

  it("does not mutate the input array", () => {
    const orig: LayerLabel[] = ["red"];
    const next = toggleColorFilter(orig, "blue");
    expect(next).toEqual(["red", "blue"]);
    expect(orig).toEqual(["red"]);
  });
});
