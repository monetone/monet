// Develop zoom (GAL-DEV-01): every pixel-level Develop decision (sharpen
// amount/radius, noise, heal placement, mask edges) rides on a real 1:1 view.
// Pins the Fit ↔ 1:1 toggle math: the click point must stay over the same
// image pixel across the zoom, the pan must stay clamped to the stage, and
// the zoomed wrap style must place the render at its native pixel size.

import { describe, expect, it } from "vitest";

import { toggleZoomAt, zoomWrapStyle } from "./DevelopView";

// A 4000×3000 render letterboxed into a 1000×600 stage: fit scale 0.2, the
// 800×600 fit box centered at left 100.
const shown = { w: 4000, h: 3000 };
const view = { w: 1000, h: 600 };
const fit = { left: 100, top: 0, width: 800 };

describe("toggleZoomAt", () => {
  it("zooms to 1:1 keeping the clicked image pixel under the cursor", () => {
    const z = toggleZoomAt(null, 500, 300, fit, shown, view);
    expect(z).not.toBeNull();
    expect(z!.scale).toBe(1);
    // Stage point (500, 300) was image pixel (2000, 1500); at scale 1 that
    // pixel must land back on the click point: pan + pixel·scale = point.
    expect(z!.pan.x + 2000).toBe(500);
    expect(z!.pan.y + 1500).toBe(300);
  });

  it("clamps the pan so a corner click cannot pull the image off the stage", () => {
    const z = toggleZoomAt(null, fit.left + 1, 1, fit, shown, view)!;
    // Pan stays within [view - shown, 0] on both axes — no empty gutters.
    expect(z.pan.x).toBeLessThanOrEqual(0);
    expect(z.pan.x).toBeGreaterThanOrEqual(view.w - shown.w);
    expect(z.pan.y).toBeLessThanOrEqual(0);
    expect(z.pan.y).toBeGreaterThanOrEqual(view.h - shown.h);
  });

  it("toggles back to fit from a zoomed state", () => {
    expect(toggleZoomAt({ scale: 1, pan: { x: -100, y: -50 } }, 10, 10, fit, shown, view)).toBeNull();
  });

  it("refuses degenerate geometry (unmeasured stage or empty render)", () => {
    expect(toggleZoomAt(null, 0, 0, fit, { w: 0, h: 0 }, view)).toBeNull();
    expect(toggleZoomAt(null, 0, 0, fit, shown, { w: 0, h: 0 })).toBeNull();
    expect(toggleZoomAt(null, 0, 0, { left: 0, top: 0, width: 0 }, shown, view)).toBeNull();
  });
});

describe("zoomWrapStyle", () => {
  it("draws the wrap at native pixel size with the pan applied", () => {
    const s = zoomWrapStyle({ scale: 1, pan: { x: -1500, y: -1200 } }, shown, view);
    expect(s.width).toBe(4000);
    expect(s.height).toBe(3000);
    expect(s.position).toBe("absolute");
    expect(s.transform).toBe("translate(-1500px, -1200px) scale(1)");
  });

  it("re-clamps a stale pan (e.g. after a stage resize)", () => {
    // Pan way past the top-left limit gets pulled back to the clamp edge.
    const s = zoomWrapStyle({ scale: 1, pan: { x: -9999, y: 50 } }, shown, view);
    expect(s.transform).toBe(`translate(${view.w - shown.w}px, 0px) scale(1)`);
  });
});
