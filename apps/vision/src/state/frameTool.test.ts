import { describe, it, expect } from "vitest";
import { frameRect, frameIsValid, frameFillOffset, MIN_FRAME } from "./frameTool";

describe("frameRect", () => {
  it("normalises a top-left → bottom-right drag", () => {
    expect(frameRect(10, 20, 60, 80, false, false)).toEqual({ x: 10, y: 20, w: 50, h: 60 });
  });

  it("normalises a bottom-right → top-left drag (negative delta)", () => {
    expect(frameRect(60, 80, 10, 20, false, false)).toEqual({ x: 10, y: 20, w: 50, h: 60 });
  });

  it("constrains to a square when `square` is set (Shift)", () => {
    const r = frameRect(0, 0, 40, 100, true, false);
    expect(r.w).toBe(r.h);
    expect(r).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("preserves the drag direction while constraining to a square", () => {
    const r = frameRect(100, 100, 60, 20, true, false); // up-left, |dx|=40 < |dy|=80
    expect(r).toEqual({ x: 20, y: 20, w: 80, h: 80 });
  });

  it("grows out from the start point when `fromCenter` is set (Alt)", () => {
    expect(frameRect(50, 50, 70, 80, false, true)).toEqual({ x: 30, y: 20, w: 40, h: 60 });
  });

  it("rounds fractional pointer coordinates", () => {
    expect(frameRect(10.4, 20.6, 30.6, 50.2, false, false)).toEqual({ x: 10, y: 21, w: 20, h: 30 });
  });
});

describe("frameIsValid", () => {
  it("rejects clicks / sub-threshold drags", () => {
    expect(frameIsValid(0, 0)).toBe(false);
    expect(frameIsValid(MIN_FRAME - 1, 100)).toBe(false);
    expect(frameIsValid(100, MIN_FRAME - 1)).toBe(false);
  });

  it("accepts a real rectangle on both axes", () => {
    expect(frameIsValid(MIN_FRAME, MIN_FRAME)).toBe(true);
    expect(frameIsValid(50, 30)).toBe(true);
  });
});

describe("frameFillOffset", () => {
  // Content at the plane origin — the fully opaque photo, unchanged by #151.
  it("centres a smaller image inside the frame", () => {
    expect(frameFillOffset({ x: 100, y: 100, w: 80, h: 60 }, { x: 0, y: 0, w: 40, h: 20 }))
      .toEqual({ dx: 120, dy: 120 });
  });

  it("centres a larger image (negative bleed) inside the frame", () => {
    expect(frameFillOffset({ x: 0, y: 0, w: 50, h: 50 }, { x: 0, y: 0, w: 100, h: 100 }))
      .toEqual({ dx: -25, dy: -25 });
  });

  it("matches the frame origin for an equally sized image", () => {
    expect(frameFillOffset({ x: 30, y: 40, w: 64, h: 48 }, { x: 0, y: 0, w: 64, h: 48 }))
      .toEqual({ dx: 30, dy: 40 });
  });

  // #151: an image with transparent margins has an alpha bbox that does NOT start
  // at the plane origin. `set_layer_offset` is absolute, so the origin must come
  // off or the content lands off-centre by exactly that origin.
  it("centres the CONTENT, not the plane, when the image has transparent margins", () => {
    // 312x312 of content at (100,100) inside a 512x512 plane, into a 400x400 frame.
    const off = frameFillOffset({ x: 0, y: 0, w: 400, h: 400 }, { x: 100, y: 100, w: 312, h: 312 });
    expect(off).toEqual({ dx: -56, dy: -56 });
    // Content centre after the offset must equal the frame centre (200, 200).
    expect(off.dx + 100 + 312 / 2).toBe(200);
    expect(off.dy + 100 + 312 / 2).toBe(200);
  });
});
