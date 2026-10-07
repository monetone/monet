// Unit tests for the selection-info helper. Engine-free (node); the Info-panel
// section + reactivity are covered by e2e/info-selection.spec.ts.
import { describe, it, expect } from "vitest";
import { selectionRect } from "./selectionInfo";

describe("selectionRect", () => {
  it("maps a valid [x,y,w,h] tuple to a rect", () => {
    expect(selectionRect([10, 20, 40, 30])).toEqual({ x: 10, y: 20, w: 40, h: 30 });
  });

  it("treats a full-canvas selection as a valid rect", () => {
    expect(selectionRect([0, 0, 100, 100])).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("returns null when width or height is zero", () => {
    expect(selectionRect([0, 0, 0, 0])).toBeNull();
    expect(selectionRect([5, 5, 10, 0])).toBeNull();
    expect(selectionRect([5, 5, 0, 10])).toBeNull();
  });

  it("returns null for a negative extent", () => {
    expect(selectionRect([1, 2, -3, 4])).toBeNull();
  });

  it("reads only the first four elements", () => {
    expect(selectionRect([1, 2, 3, 4, 99])).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});
