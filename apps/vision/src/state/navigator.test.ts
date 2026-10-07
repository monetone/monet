// Unit tests for the Navigator geometry. Engine-free (node); the panel wiring +
// docThumbUrl thumbnail are covered by e2e/navigator.spec.ts.
import { describe, it, expect } from "vitest";
import { visibleDocRect, thumbBox, viewRectInThumb, panForCenter } from "./navigator";

describe("visibleDocRect", () => {
  it("at zoom 1, pan 0 spans the whole viewport in doc px", () => {
    expect(visibleDocRect(1, 0, 0, 200, 150)).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });

  it("at zoom 2 shows half the doc region (smaller w/h)", () => {
    expect(visibleDocRect(2, 0, 0, 200, 150)).toEqual({ x: 0, y: 0, w: 100, h: 75 });
  });

  it("a positive pan scrolls the visible origin to negative doc coords", () => {
    // pan 40 right at zoom 2 → top-left doc x = -40/2 = -20
    expect(visibleDocRect(2, 40, 20, 200, 150)).toEqual({ x: -20, y: -10, w: 100, h: 75 });
  });

  it("zoom <= 0 returns all zeros", () => {
    expect(visibleDocRect(0, 0, 0, 200, 150)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("uses corrected pixel aspect on the horizontal axis only", () => {
    expect(visibleDocRect(2, -40, -20, 200, 150, 2)).toEqual({ x: 10, y: 10, w: 50, h: 75 });
  });
});

describe("thumbBox", () => {
  it("contains a landscape doc, never upscaling", () => {
    // 400×300 into 200×140 → scale = min(0.5, 0.4667, 1) = 0.4667 → 187×140
    const t = thumbBox(400, 300, 200, 140);
    expect(t.scale).toBeCloseTo(140 / 300, 6);
    expect(t).toMatchObject({ w: 187, h: 140 });
  });

  it("never upscales a doc smaller than the box (scale capped at 1)", () => {
    expect(thumbBox(50, 40, 200, 140)).toEqual({ w: 50, h: 40, scale: 1 });
  });

  it("returns zeros for a degenerate doc", () => {
    expect(thumbBox(0, 100, 200, 140)).toEqual({ w: 0, h: 0, scale: 0 });
  });
});

describe("viewRectInThumb", () => {
  it("maps the full visible rect to the full thumb when the whole doc is visible", () => {
    const vis = { x: 0, y: 0, w: 400, h: 300 };
    expect(viewRectInThumb(vis, 400, 300, 200, 150)).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });

  it("maps a half-doc visible rect to a quarter-area box in the thumb", () => {
    // visible top-left quarter of the doc → top-left quarter of the thumb
    const vis = { x: 0, y: 0, w: 200, h: 150 };
    expect(viewRectInThumb(vis, 400, 300, 200, 150)).toEqual({ x: 0, y: 0, w: 100, h: 75 });
  });

  it("clamps a visible rect that overflows the doc bounds to the thumb edges", () => {
    // zoomed out past the doc: visible rect extends beyond the doc on all sides
    const vis = { x: -100, y: -100, w: 800, h: 600 };
    expect(viewRectInThumb(vis, 400, 300, 200, 150)).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });

  it("returns zeros for a degenerate doc", () => {
    expect(viewRectInThumb({ x: 0, y: 0, w: 10, h: 10 }, 0, 300, 200, 150)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("panForCenter", () => {
  it("centres a doc point in the viewport", () => {
    // doc (100,100) at zoom 1 in a 200×150 viewport → pan = (100-100, 75-100)
    expect(panForCenter(100, 100, 1, 200, 150)).toEqual({ panX: 0, panY: -25 });
  });

  it("accounts for zoom when centring", () => {
    // doc (50,50) at zoom 2 → screen 100 → pan = vp/2 - 100
    expect(panForCenter(50, 50, 2, 200, 150)).toEqual({ panX: 0, panY: -25 });
  });

  it("offsets on both axes for an off-centre target", () => {
    // doc (200,100) at zoom 2 in a 300×200 viewport → pan = (150-400, 100-200)
    expect(panForCenter(200, 100, 2, 300, 200)).toEqual({ panX: -250, panY: -100 });
  });

  it("centres using corrected pixel aspect on the horizontal axis", () => {
    expect(panForCenter(50, 50, 2, 200, 150, 2)).toEqual({ panX: -100, panY: -25 });
  });
});
