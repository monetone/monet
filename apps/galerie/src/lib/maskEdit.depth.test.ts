// Depth Range authoring spec — the third Range sub-tool: a depth component can
// be created, stacked, and reaches the composite loop's renderable set.

import { createMaskGraph, type DepthRangeComponent } from "@monet-ui/monet-photo";
import { describe, expect, it } from "vitest";

import { needsBaseImage, newComponent, newRangeMask, renderableMasks } from "./maskEdit";

describe("newComponent('rangeDepth')", () => {
  it("seeds the near half of the depth range with a feathered band", () => {
    const c = newComponent("rangeDepth", "c1", "intersect") as DepthRangeComponent;
    expect(c).toEqual({
      kind: "rangeDepth",
      id: "c1",
      combine: "intersect",
      invert: false,
      near: 0,
      far: 0.5,
      smoothness: 0.5,
    });
  });
});

describe("depth masks in the render path", () => {
  it("newRangeMask builds a depth mask whose base is the depth component", () => {
    const m = newRangeMask("rangeDepth", "m1", "Depth 1");
    expect(m.components).toHaveLength(1);
    expect(m.components[0].kind).toBe("rangeDepth");
    expect(m.enabled).toBe(true);
  });

  it("is renderable (parametric coverage, not an AI cache) and needs the source", () => {
    const graph = { ...createMaskGraph(), masks: [newRangeMask("rangeDepth", "m1", "Depth 1")] };
    expect(renderableMasks(graph).map((m) => m.id)).toEqual(["m1"]);
    // The depth channel rides on the MaskRenderSource, so the source must be built.
    expect(needsBaseImage(graph.masks)).toBe(true);
  });

  it("skips a disabled depth mask", () => {
    const m = { ...newRangeMask("rangeDepth", "m1", "Depth 1"), enabled: false };
    expect(renderableMasks({ ...createMaskGraph(), masks: [m] })).toEqual([]);
  });
});
