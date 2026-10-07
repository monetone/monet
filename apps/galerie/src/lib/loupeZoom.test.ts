import { describe, expect, it } from "vitest";

import { centerPan, clampPan, fitScale, zoomToPoint, panForFocus, rescaleZoom, detailScale } from "./loupeZoom";

describe("fitScale", () => {
  it("contains the image (limited by the tighter axis)", () => {
    expect(fitScale(2000, 1000, 800, 800)).toBeCloseTo(0.4, 9); // width-bound
    expect(fitScale(1000, 2000, 800, 800)).toBeCloseTo(0.4, 9); // height-bound
  });
  it("guards degenerate sizes", () => {
    expect(fitScale(0, 0, 800, 800)).toBe(1);
  });
});

describe("centerPan", () => {
  it("centers the scaled image", () => {
    expect(centerPan(1000, 1000, 0.5, 800, 600)).toEqual({ x: 150, y: 50 });
  });
});

describe("clampPan", () => {
  it("keeps a larger-than-view image covering the viewport", () => {
    // Scaled 1000×1000 in a 500×500 view: pan ∈ [-500, 0].
    expect(clampPan({ x: 100, y: -900 }, 1000, 1000, 1, 500, 500)).toEqual({ x: 0, y: -500 });
    expect(clampPan({ x: -200, y: -200 }, 1000, 1000, 1, 500, 500)).toEqual({ x: -200, y: -200 });
  });
  it("centers a smaller-than-view image regardless of the requested pan", () => {
    expect(clampPan({ x: 999, y: -999 }, 200, 200, 1, 500, 500)).toEqual({ x: 150, y: 150 });
  });
});

describe("zoomToPoint", () => {
  it("keeps the clicked point over the same image pixel", () => {
    // 1000×1000 image fit in 500×500 (scale 0.5, centered at (0,0)); zoom to 1:1
    // clicking the centre.
    const z = zoomToPoint(250, 250, 0.5, { x: 0, y: 0 }, 1, 1000, 1000, 500, 500);
    expect(z.scale).toBe(1);
    // The centre pixel (500) must map back under the cursor.
    const backX = z.pan.x + 500 * z.scale;
    expect(backX).toBeCloseTo(250, 6);
  });

  it("clamps when zooming at a corner (no empty gap)", () => {
    const z = zoomToPoint(0, 0, 0.5, { x: 0, y: 0 }, 1, 1000, 1000, 500, 500);
    // Top-left corner: pan pinned at 0 (can't show past the edge).
    expect(z.pan).toEqual({ x: 0, y: 0 });
  });

  it("round-trips fit → zoom → fit back to the centered fit view", () => {
    const s = fitScale(1200, 800, 600, 600); // 0.5
    const fit = centerPan(1200, 800, s, 600, 600);
    const zoomed = zoomToPoint(300, 300, s, fit, 1, 1200, 800, 600, 600);
    const backToFit = zoomToPoint(300, 300, zoomed.scale, zoomed.pan, s, 1200, 800, 600, 600);
    expect(backToFit.scale).toBe(s);
    expect(backToFit.pan.x).toBeCloseTo(fit.x, 6);
    expect(backToFit.pan.y).toBeCloseTo(fit.y, 6);
  });
});

describe("panForFocus (Compare synced zoom)", () => {
  it("puts the focal point at the view centre when the image is larger", () => {
    // 4000×3000 at 1:1 in an 800×600 view; focus the exact middle.
    const p = panForFocus(0.5, 0.5, 4000, 3000, 1, 800, 600);
    expect(p).toEqual({ x: 400 - 2000, y: 300 - 1500 });
  });

  it("clamps at the edges so no gap opens", () => {
    const p = panForFocus(0, 0, 4000, 3000, 1, 800, 600);
    expect(p).toEqual({ x: 0, y: 0 }); // top-left corner pins to the view corner
    const q = panForFocus(1, 1, 4000, 3000, 1, 800, 600);
    expect(q).toEqual({ x: 800 - 4000, y: 600 - 3000 });
  });

  it("centers an image smaller than the view regardless of focus", () => {
    const p = panForFocus(0.1, 0.9, 400, 300, 1, 800, 600);
    expect(p).toEqual({ x: 200, y: 150 });
  });
});

describe("rescaleZoom (progressive 1:1 upgrade)", () => {
  it("keeps the content's visual size and position across a decode swap", () => {
    // 1000×800 decode at 2× in an 800×600 view, panned; a 4× decode arrives.
    const z = rescaleZoom({ scale: 2, pan: { x: -100, y: -50 } }, 1000, 4000, 3200, 800, 600);
    expect(z.scale).toBeCloseTo(0.5); // 2 × (1000/4000)
    expect(z.pan).toEqual({ x: -100, y: -50 }); // same screen placement
    // The image point under the view centre is the same content fraction.
    const oldFrac = (400 - -100) / 2 / 1000;
    const newFrac = (400 - z.pan.x) / z.scale / 4000;
    expect(newFrac).toBeCloseTo(oldFrac);
  });

  it("re-clamps when the new decode changes the scaled extent", () => {
    // Same visual extent by construction, so an in-bounds pan stays put even
    // at the clamp boundary.
    const z = rescaleZoom({ scale: 1, pan: { x: 800 - 2000, y: 0 } }, 2000, 4000, 3000, 800, 600);
    expect(z.scale).toBeCloseTo(0.5);
    expect(z.pan.x).toBeCloseTo(-1200);
  });

  it("returns the zoom unchanged for degenerate dimensions", () => {
    const zoom = { scale: 2, pan: { x: -10, y: -10 } };
    expect(rescaleZoom(zoom, 0, 4000, 3000, 800, 600)).toBe(zoom);
  });
});

describe("detailScale", () => {
  it("targets the deliverable edge: upscales a fit-sized decode of a big photo", () => {
    expect(detailScale(2560, 1707, 6000)).toBeCloseTo(6000 / 2560);
  });

  it("caps at 1:1 for photos at or under the decode edge", () => {
    expect(detailScale(1800, 1200, 1800)).toBe(1);
  });

  it("uses decode-relative 1:1 when the target edge is unknown", () => {
    expect(detailScale(2560, 1707, 0)).toBe(1);
  });
});
