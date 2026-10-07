// Unit tests for the layer-navigation helper. Engine-free (node); the store
// method + Alt+bracket keydown wiring are covered by e2e/layer-nav.spec.ts.
import { describe, it, expect } from "vitest";
import { adjacentLayerIndex } from "./layerNav";

describe("adjacentLayerIndex", () => {
  it("steps up (toward index 0) and down", () => {
    expect(adjacentLayerIndex(1, 3, -1)).toBe(0);
    expect(adjacentLayerIndex(1, 3, 1)).toBe(2);
  });

  it("clamps at the top and bottom", () => {
    expect(adjacentLayerIndex(0, 3, -1)).toBe(0);
    expect(adjacentLayerIndex(2, 3, 1)).toBe(2);
  });

  it("jumps to the first/last row when toEnd", () => {
    expect(adjacentLayerIndex(1, 3, -1, true)).toBe(0);
    expect(adjacentLayerIndex(1, 3, 1, true)).toBe(2);
  });

  it("returns -1 when there are no layers", () => {
    expect(adjacentLayerIndex(0, 0, -1)).toBe(-1);
  });
});
