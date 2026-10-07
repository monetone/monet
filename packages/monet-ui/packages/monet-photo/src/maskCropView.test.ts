// maskCropView — the crop-view ↔ full-frame mapping mask tools edit through
// (GAL-MASK-02: masks live in full-frame space while the canvas shows the crop).
import { describe, expect, it } from "vitest";

import { createMask, type BrushComponent, type LinearGradientComponent, type RadialGradientComponent } from "./maskGraph";
import {
  computeMaskCoverage,
  cropRadiusToFrame,
  cropToFrame,
  frameToCrop,
  maskToCropSpace,
  maskToFrameSpace,
  type CropView,
} from "./maskRender";

const view = (over: Partial<CropView> = {}): CropView => ({
  rect: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
  angle: 0,
  width: 200,
  height: 100,
  ...over,
});

describe("cropToFrame / frameToCrop", () => {
  it("is the identity for the full-frame view", () => {
    const v = view({ rect: { left: 0, top: 0, right: 1, bottom: 1 } });
    expect(cropToFrame(v, 0.3, 0.8)).toEqual({ x: 0.3, y: 0.8 });
    expect(frameToCrop(v, 0.3, 0.8)).toEqual({ x: 0.3, y: 0.8 });
  });

  it("maps the crop window's corners and centre for a rect-only crop", () => {
    const v = view();
    expect(cropToFrame(v, 0, 0)).toEqual({ x: 0.25, y: 0.25 });
    expect(cropToFrame(v, 1, 1)).toEqual({ x: 0.75, y: 0.75 });
    expect(cropToFrame(v, 0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(frameToCrop(v, 0.25, 0.25)).toEqual({ x: 0, y: 0 });
  });

  it("round-trips through a straightened crop", () => {
    const v = view({ angle: 7.3 });
    const p = cropToFrame(v, 0.2, 0.9);
    const back = frameToCrop(v, p.x, p.y);
    expect(back.x).toBeCloseTo(0.2, 10);
    expect(back.y).toBeCloseTo(0.9, 10);
  });

  it("rotates about the frame centre (90° on a square frame)", () => {
    const v = view({ rect: { left: 0, top: 0, right: 1, bottom: 1 }, angle: 90, width: 100, height: 100 });
    const p = cropToFrame(v, 1, 0.5); // right-middle samples the top-middle source
    expect(p.x).toBeCloseTo(0.5, 10);
    expect(p.y).toBeCloseTo(0, 10);
  });
});

describe("cropRadiusToFrame", () => {
  it("scales a display radius by the crop's shorter side", () => {
    // Frame 100x100, half-size crop: a display radius covers half as much frame.
    const v = view({ rect: { left: 0, top: 0, right: 0.5, bottom: 0.5 }, width: 100, height: 100 });
    expect(cropRadiusToFrame(v, 0.2)).toBeCloseTo(0.1, 10);
    // Full-frame view: unchanged.
    expect(cropRadiusToFrame(view({ rect: { left: 0, top: 0, right: 1, bottom: 1 } }), 0.2)).toBeCloseTo(0.2, 10);
  });
});

describe("maskToCropSpace / maskToFrameSpace", () => {
  const linear: LinearGradientComponent = {
    kind: "linearGradient", id: "l", combine: "add", invert: false,
    x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75,
  };
  const radial: RadialGradientComponent = {
    kind: "radialGradient", id: "r", combine: "add", invert: false,
    cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.2, angle: 0, feather: 0.5,
  };
  const brush: BrushComponent = {
    kind: "brush", id: "b", combine: "add", invert: false,
    dabs: [{ x: 0.4, y: 0.6, radius: 0.05, flow: 1, density: 1, erase: false }],
    autoMask: false,
  };

  it("maps gradient geometry into the crop view and leaves brush dabs alone", () => {
    const mask = { ...createMask("m", "M", linear), components: [linear, radial, brush] };
    const mapped = maskToCropSpace(mask, view());
    const [l, r, b] = mapped.components as [LinearGradientComponent, RadialGradientComponent, BrushComponent];
    // Frame (0.25,0.25)/(0.75,0.75) are the crop window's corners.
    expect(l.x1).toBeCloseTo(0, 10);
    expect(l.y1).toBeCloseTo(0, 10);
    expect(l.x2).toBeCloseTo(1, 10);
    expect(l.y2).toBeCloseTo(1, 10);
    // Radii scale per-axis by the crop fraction (0.5 each way).
    expect(r.cx).toBeCloseTo(0.5, 10);
    expect(r.rx).toBeCloseTo(0.2, 10);
    expect(r.ry).toBeCloseTo(0.4, 10);
    // Dabs are stamped pre-mapped, so mapping must not touch them.
    expect(b.dabs).toEqual(brush.dabs);
  });

  it("round-trips through a straightened crop view", () => {
    const v = view({ angle: -4.2 });
    const mask = { ...createMask("m", "M", linear), components: [linear, radial] };
    const back = maskToFrameSpace(maskToCropSpace(mask, v), v);
    const [l, r] = back.components as [LinearGradientComponent, RadialGradientComponent];
    expect(l.x1).toBeCloseTo(linear.x1, 10);
    expect(l.y2).toBeCloseTo(linear.y2, 10);
    expect(r.cx).toBeCloseTo(radial.cx, 10);
    expect(r.rx).toBeCloseTo(radial.rx, 10);
  });

  it("stamps a dab through cropToFrame under the display pixel it was painted on", () => {
    // Crop shows the bottom-right quarter of a 100x100 frame; painting at the
    // display centre must land at frame (0.75, 0.75), not (0.5, 0.5).
    const v = view({ rect: { left: 0.5, top: 0.5, right: 1, bottom: 1 }, width: 100, height: 100 });
    const p = cropToFrame(v, 0.5, 0.5);
    const radius = cropRadiusToFrame(v, 0.2);
    const mask = createMask("m", "M", {
      kind: "brush", id: "b", combine: "add", invert: false,
      dabs: [{ x: p.x, y: p.y, radius, flow: 1, density: 1, erase: false }],
      autoMask: false,
    });
    const cov = computeMaskCoverage(mask, 100, 100);
    expect(cov[74 * 100 + 74]).toBeGreaterThan(0.9); // under the cursor
    expect(cov[50 * 100 + 50]).toBe(0); // where the unmapped stamp would land
  });
});
