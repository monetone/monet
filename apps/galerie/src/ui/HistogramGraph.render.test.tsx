// HistogramGraph — clipping triangles + cursor readout. Renders the real
// component from a plain Histogram (no catalog, no canvas), plus the pointer /
// region maths the readout depends on.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { clipping, computeHistogram, levelAt, levelShare, toneRegion } from "../lib/histogram";
import { HistogramGraph } from "./HistogramPanel";

function hist(...px: [number, number, number][]) {
  const data = new Uint8ClampedArray(px.length * 4);
  px.forEach((p, i) => data.set([...p, 255], i * 4));
  return computeHistogram(data);
}

const render = (...px: [number, number, number][]) =>
  renderToStaticMarkup(<HistogramGraph hist={hist(...px)} />);

describe("clipping triangles", () => {
  it("lights the highlight triangle in the clipped channels' additive colour", () => {
    // 1 of 4 pixels blows out in red only.
    const html = render([255, 10, 10], [128, 128, 128], [128, 128, 128], [128, 128, 128]);
    expect(html).toContain('aria-label="Highlight clipping: 25% of pixels"');
    expect(html).toContain("background:rgb(255,0,0)");
    expect(html).toContain('aria-label="No shadow clipping"');
  });

  it("shows white when every channel clips, and reports both ends", () => {
    const html = render([255, 255, 255], [0, 0, 0]);
    expect(html).toContain('aria-label="Highlight clipping: 50% of pixels"');
    expect(html).toContain('aria-label="Shadow clipping: 50% of pixels"');
    expect(html).toContain("background:rgb(255,255,255)");
    expect(html).toContain("Clipping 50% / 50%");
  });

  it("stays dim with no clipping and leaves the readout empty", () => {
    const html = render([128, 128, 128], [64, 64, 64]);
    expect(html).toContain('aria-label="No shadow clipping"');
    expect(html).toContain('aria-label="No highlight clipping"');
    expect(html).not.toContain("Clipping ");
  });

  it("counts a pixel clipped in two channels once", () => {
    const c = clipping(hist([255, 255, 10], [128, 128, 128]));
    expect(c.highlights).toBe(0.5);
    expect(c.highlightColor).toBe("rgb(255,255,0)");
  });

  it("reports 0% rather than NaN for an all-transparent frame", () => {
    const c = clipping(computeHistogram(new Uint8ClampedArray([0, 0, 0, 0])));
    expect(c.shadows).toBe(0);
    expect(c.highlights).toBe(0);
  });
});

describe("cursor readout", () => {
  it("names the tone region across the axis", () => {
    expect(toneRegion(0)).toBe("Blacks");
    expect(toneRegion(25)).toBe("Blacks");
    expect(toneRegion(26)).toBe("Shadows");
    expect(toneRegion(128)).toBe("Exposure");
    expect(toneRegion(200)).toBe("Highlights");
    expect(toneRegion(255)).toBe("Whites");
  });

  it("maps pointer x onto 0–255 and clamps past either edge", () => {
    expect(levelAt(0, 255)).toBe(0);
    expect(levelAt(128, 255)).toBe(128);
    expect(levelAt(-40, 255)).toBe(0);
    expect(levelAt(400, 255)).toBe(255);
    expect(levelAt(10, 0)).toBe(0); // zero-width box (unlaid-out panel)
  });

  it("shares each channel's population at one level", () => {
    const s = levelShare(hist([128, 64, 64], [128, 128, 128], [0, 0, 0], [0, 0, 0]), 128);
    expect(s.r).toBe(0.5);
    expect(s.g).toBe(0.25);
    expect(s.b).toBe(0.25);
    expect(levelShare(hist([128, 128, 128]), 999).r).toBe(0); // clamped to 255
  });
});
