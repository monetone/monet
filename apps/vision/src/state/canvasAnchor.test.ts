// Unit tests for the Canvas Size geometry. Engine-free (node); the dialog wiring is
// covered by e2e/canvas-size.spec.ts.
import { describe, it, expect } from "vitest";
import { resolveCanvasSize, canvasSizeFits, anchorOffset } from "./canvasAnchor";

describe("resolveCanvasSize", () => {
  it("passes inputs through in absolute mode", () => {
    expect(resolveCanvasSize(1000, 500, 800, 400, false)).toEqual({ w: 800, h: 400 });
  });
  it("adds deltas in relative mode (positive grows)", () => {
    expect(resolveCanvasSize(1000, 500, 200, 100, true)).toEqual({ w: 1200, h: 600 });
  });
  it("subtracts in relative mode (negative crops)", () => {
    expect(resolveCanvasSize(1000, 500, -200, -100, true)).toEqual({ w: 800, h: 400 });
  });
  it("clamps to >= 1 and rounds", () => {
    expect(resolveCanvasSize(1000, 500, -2000, 0, true)).toEqual({ w: 1, h: 500 });
    expect(resolveCanvasSize(1000, 500, 333.6, 100, false)).toEqual({ w: 334, h: 100 });
  });
});

describe("canvasSizeFits", () => {
  it("enforces the document dimension and pixel budgets", () => {
    expect(canvasSizeFits(8944, 8944)).toBe(true);
    expect(canvasSizeFits(8945, 8945)).toBe(false);
    expect(canvasSizeFits(32_768, 1)).toBe(false);
  });
});

describe("anchorOffset", () => {
  it("top-left anchor keeps content at the origin", () => {
    expect(anchorOffset(1000, 500, 1200, 600, 0, 0)).toEqual({ dx: 0, dy: 0 });
  });
  it("centre anchor splits the added space evenly", () => {
    expect(anchorOffset(1000, 500, 1200, 600, 1, 1)).toEqual({ dx: 100, dy: 50 });
  });
  it("bottom-right anchor pushes content fully into the new space", () => {
    expect(anchorOffset(1000, 500, 1200, 600, 2, 2)).toEqual({ dx: 200, dy: 100 });
  });
  it("mixes per-axis (right edge, top row)", () => {
    expect(anchorOffset(1000, 500, 1200, 600, 2, 0)).toEqual({ dx: 200, dy: 0 });
  });
  it("yields negative offsets when shrinking with the centre anchor (crop)", () => {
    expect(anchorOffset(1000, 500, 800, 400, 1, 1)).toEqual({ dx: -100, dy: -50 });
  });
});
