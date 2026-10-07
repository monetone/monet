// Unit tests for the Zoom preset math. Engine-free (node); the options-bar buttons
// + canvas application are covered by e2e/zoom-presets.spec.ts.
import { describe, it, expect } from "vitest";
import { clampZoom, fitZoom, fillZoom, fitRectView } from "./zoomPresets";

describe("clampZoom", () => {
  it("clamps to [0.02, 32]", () => {
    expect(clampZoom(0.001)).toBe(0.02);
    expect(clampZoom(100)).toBe(32);
    expect(clampZoom(1)).toBe(1);
  });
});

describe("fitZoom", () => {
  it("uses the smaller ratio (whole doc fits) with the margin", () => {
    // 300×300 doc in a 900×600 viewport: min(3, 2) * 0.9 = 1.8
    expect(fitZoom(900, 600, 300, 300)).toBeCloseTo(1.8, 5);
  });
  it("clamps an oversized document toward the minimum", () => {
    expect(fitZoom(100, 100, 100000, 100000)).toBe(0.02);
  });
  it("clamps a tiny document toward the maximum", () => {
    expect(fitZoom(8000, 8000, 1, 1)).toBe(32);
  });
  it("returns 1 for a degenerate document", () => {
    expect(fitZoom(900, 600, 0, 300)).toBe(1);
  });
});

describe("fillZoom", () => {
  it("uses the larger ratio (doc covers the viewport)", () => {
    // 300×300 doc in a 900×600 viewport: max(3, 2) = 3
    expect(fillZoom(900, 600, 300, 300)).toBe(3);
  });
  it("is always >= fitZoom for the same inputs", () => {
    expect(fillZoom(900, 600, 300, 300)).toBeGreaterThan(fitZoom(900, 600, 300, 300));
    expect(fillZoom(640, 480, 200, 360)).toBeGreaterThanOrEqual(fitZoom(640, 480, 200, 360));
  });
  it("returns 1 for a degenerate document", () => {
    expect(fillZoom(900, 600, 300, 0)).toBe(1);
  });
});

describe("fitRectView", () => {
  it("fits and centres a full-canvas rect exactly like fitZoom + centred pan", () => {
    // Rect [0,0,299,299] spans 300×300 in a 900×600 viewport.
    const { zoom, panX, panY } = fitRectView(900, 600, 0, 0, 299, 299);
    expect(zoom).toBeCloseTo(1.8, 5); // = fitZoom(900,600,300,300)
    // rect centre (150,150) lands at the viewport centre (450,300)
    expect(panX + 150 * zoom).toBeCloseTo(450, 5);
    expect(panY + 150 * zoom).toBeCloseTo(300, 5);
  });

  it("centres an off-origin rect on its own content centre", () => {
    // Rect [10,20,109,219] spans 100×200; its centre is (60,120).
    const { zoom, panX, panY } = fitRectView(900, 600, 10, 20, 109, 219);
    expect(zoom).toBeCloseTo(fitZoom(900, 600, 100, 200), 5);
    expect(panX + 60 * zoom).toBeCloseTo(450, 5);
    expect(panY + 120 * zoom).toBeCloseTo(300, 5);
  });

  it("uses inclusive bounds (a single-pixel rect spans 1, not 0)", () => {
    const { zoom } = fitRectView(800, 800, 5, 5, 5, 5); // 1×1 content
    expect(zoom).toBe(32); // clamped max — a tiny rect zooms all the way in
  });
});
