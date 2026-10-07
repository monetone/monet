import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORTING_LAYER,
  SORTING_LAYER_STRIDE,
  sortingLayers,
  sortingLayerIndex,
  effectiveDepth,
} from "./sorting";

describe("sortingLayers", () => {
  it("defaults to a single Default layer when missing or empty", () => {
    expect(sortingLayers({})).toEqual(["Default"]);
    expect(sortingLayers({ sortingLayers: [] })).toEqual(["Default"]);
  });

  it("keeps the configured order and ensures Default is present", () => {
    expect(sortingLayers({ sortingLayers: ["Default", "FX"] })).toEqual(["Default", "FX"]);
    expect(sortingLayers({ sortingLayers: ["Background", "FX"] })).toEqual(["Default", "Background", "FX"]);
  });
});

describe("sortingLayerIndex", () => {
  const layers = ["Default", "Midground", "Foreground"];
  it("returns the index of a known layer", () => {
    expect(sortingLayerIndex(layers, "Midground")).toBe(1);
    expect(sortingLayerIndex(layers, "Foreground")).toBe(2);
  });
  it("maps an unknown or omitted layer to Default's index", () => {
    expect(sortingLayerIndex(layers, "Ghost")).toBe(0);
    expect(sortingLayerIndex(layers, undefined)).toBe(0);
    expect(sortingLayerIndex(["Back", "Default"], undefined)).toBe(1); // Default not first
  });
});

describe("effectiveDepth", () => {
  it("equals the order-in-layer for a Default-only project (no behaviour change)", () => {
    const layers = [DEFAULT_SORTING_LAYER];
    expect(effectiveDepth({ depth: 5 }, layers)).toBe(5);
    expect(effectiveDepth({ depth: -3, sortingLayer: "Default" }, layers)).toBe(-3);
  });

  it("ranks a later sorting layer above an earlier one regardless of depth", () => {
    const layers = ["Default", "Foreground"];
    const back = effectiveDepth({ sortingLayer: "Default", depth: 9999 }, layers);
    const front = effectiveDepth({ sortingLayer: "Foreground", depth: 0 }, layers);
    expect(front).toBeGreaterThan(back);
    expect(front).toBe(SORTING_LAYER_STRIDE);
  });

  it("breaks ties within a layer by order-in-layer (depth)", () => {
    const layers = ["Default", "Foreground"];
    const lo = effectiveDepth({ sortingLayer: "Foreground", depth: 1 }, layers);
    const hi = effectiveDepth({ sortingLayer: "Foreground", depth: 2 }, layers);
    expect(hi).toBeGreaterThan(lo);
    expect(hi - lo).toBe(1);
  });
});
