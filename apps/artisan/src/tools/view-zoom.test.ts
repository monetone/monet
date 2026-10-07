// ─────────────────────────────────────────────────────────────
// tools/view-zoom.test — zoom clamp (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator clamps the zoom to a finite range (it tops out
// around 64000% and bottoms out near 2%).

import { describe, it, expect } from "vitest";
import { clampZoom, MIN_ZOOM, MAX_ZOOM } from "./view";

describe("view.clampZoom", () => {
  it("passes through an in-range value", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });
  it("clamps above the maximum", () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
  });
  it("clamps below the minimum", () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
  });
});
