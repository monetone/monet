// Unit tests for the Camera Raw clipping overlay. Engine-free (node); the
// clickable clip readouts + preview render are covered by the
// camera-raw-workspace e2e.
import { describe, it, expect } from "vitest";
import { clippingOverlay } from "./clippingOverlay";

function field(w: number, h: number, v: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255; }
  return px;
}
const red = (px: Uint8ClampedArray, i = 0) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];

describe("clippingOverlay", () => {
  it("marks blown highlights red when highlights are shown", () => {
    const out = clippingOverlay(field(4, 4, 255), 4, 4, false, true);
    expect(red(out)).toEqual([255, 0, 0]);
  });

  it("marks crushed shadows blue when shadows are shown", () => {
    const out = clippingOverlay(field(4, 4, 0), 4, 4, true, false);
    expect(red(out)).toEqual([0, 0, 255]);
  });

  it("leaves mid-tones untouched", () => {
    const out = clippingOverlay(field(4, 4, 128), 4, 4, true, true);
    expect(red(out)).toEqual([128, 128, 128]);
  });

  it("returns an unchanged copy when both flags are off", () => {
    const src = field(4, 4, 255);
    const out = clippingOverlay(src, 4, 4, false, false);
    expect(red(out)).toEqual([255, 255, 255]); // not marked
    expect(out).not.toBe(src); // a copy, not the same buffer
  });

  it("only shadows are marked when only shadows are shown (a blown highlight stays)", () => {
    const px = field(4, 4, 0);
    px[0] = 255; px[1] = 255; px[2] = 255; // pixel 0 is a blown highlight
    const out = clippingOverlay(px, 4, 4, true, false);
    expect(red(out, 0)).toEqual([255, 255, 255]); // highlight not marked (highlights off)
    expect(red(out, 1)).toEqual([0, 0, 255]); // a shadow pixel → blue
  });
});
