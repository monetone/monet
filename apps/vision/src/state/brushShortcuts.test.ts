// Unit tests for the brush keyboard-step helpers. Engine-free (node); the keydown
// wiring is covered by e2e/brush-shortcuts.spec.ts.
import { describe, it, expect } from "vitest";
import { stepBrushSize, stepBrushHardness } from "./brushShortcuts";

describe("stepBrushSize", () => {
  it("steps ±2 px", () => {
    expect(stepBrushSize(24, 1)).toBe(26);
    expect(stepBrushSize(24, -1)).toBe(22);
  });

  it("clamps to a 1 px minimum", () => {
    expect(stepBrushSize(1, -1)).toBe(1);
    expect(stepBrushSize(2, -1)).toBe(1);
  });
});

describe("stepBrushHardness", () => {
  it("steps ±0.25", () => {
    expect(stepBrushHardness(0.5, 1)).toBe(0.75);
    expect(stepBrushHardness(0.5, -1)).toBe(0.25);
    expect(stepBrushHardness(0.8, -1)).toBe(0.55);
  });

  it("clamps to 0..1", () => {
    expect(stepBrushHardness(0.8, 1)).toBe(1);
    expect(stepBrushHardness(0.9, 1)).toBe(1);
    expect(stepBrushHardness(0.1, -1)).toBe(0);
  });
});
