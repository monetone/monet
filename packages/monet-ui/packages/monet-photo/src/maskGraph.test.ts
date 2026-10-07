import { describe, expect, it } from "vitest";

import {
  createLocalAdjustments,
  createMask,
  createMaskGraph,
  type BrushComponent,
} from "./maskGraph";

describe("maskGraph", () => {
  it("neutral local adjustments are all zero", () => {
    const a = createLocalAdjustments();
    expect(Object.values(a).every((v) => v === 0)).toBe(true);
  });

  it("createMask seeds one base component + neutral adjustments", () => {
    const base: BrushComponent = {
      kind: "brush",
      id: "c1",
      combine: "add",
      invert: false,
      dabs: [{ x: 0.5, y: 0.5, radius: 0.1, flow: 1, density: 1, erase: false }],
      autoMask: true,
    };
    const m = createMask("m1", "Brush 1", base);
    expect(m.id).toBe("m1");
    expect(m.enabled).toBe(true);
    expect(m.components).toHaveLength(1);
    expect(m.components[0]).toBe(base);
    expect(m.adjustments.exposure).toBe(0);
  });

  it("empty graph has no masks", () => {
    expect(createMaskGraph().masks).toEqual([]);
  });
});
