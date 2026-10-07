import { describe, expect, it } from "vitest";

import { applyCrop, isIdentityCrop, type CropImage } from "./cropTransform";

/** Build an image where each pixel's RGB encodes its (x, y) so mappings are visible. */
function img(W: number, H: number): CropImage {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      rgba[o] = x * 10;
      rgba[o + 1] = y * 10;
      rgba[o + 2] = 0;
      rgba[o + 3] = 255;
    }
  }
  return { rgba, width: W, height: H };
}

const px = (im: CropImage, x: number, y: number): [number, number, number] => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o], im.rgba[o + 1], im.rgba[o + 2]];
};

const FULL = { top: 0, left: 0, bottom: 1, right: 1 };

describe("isIdentityCrop", () => {
  it("is true only for the full frame with no straighten", () => {
    expect(isIdentityCrop({ rect: FULL, angle: 0 })).toBe(true);
    expect(isIdentityCrop({ rect: FULL, angle: 2 })).toBe(false);
    expect(isIdentityCrop({ rect: { top: 0, left: 0.1, bottom: 1, right: 1 }, angle: 0 })).toBe(false);
  });
});

describe("applyCrop", () => {
  it("returns an unchanged copy for an identity crop", () => {
    const src = img(4, 4);
    const out = applyCrop(src, { rect: FULL, angle: 0 });
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(Array.from(out.rgba)).toEqual(Array.from(src.rgba));
    expect(out.rgba).not.toBe(src.rgba); // a copy, not the same buffer
  });

  it("extracts the top-left quadrant", () => {
    const src = img(4, 4);
    const out = applyCrop(src, { rect: { top: 0, left: 0, bottom: 0.5, right: 0.5 }, angle: 0 });
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(px(out, 0, 0)).toEqual(px(src, 0, 0));
    expect(px(out, 1, 1)).toEqual(px(src, 1, 1));
  });

  it("extracts the right half at the correct offset", () => {
    const src = img(4, 4);
    const out = applyCrop(src, { rect: { top: 0, left: 0.5, bottom: 1, right: 1 }, angle: 0 });
    expect([out.width, out.height]).toEqual([2, 4]);
    expect(px(out, 0, 0)).toEqual(px(src, 2, 0)); // left edge of the crop is source x=2
  });

  it("sizes the output to the crop rect", () => {
    const out = applyCrop(img(8, 8), { rect: { top: 0.25, left: 0.25, bottom: 0.75, right: 0.75 }, angle: 0 });
    expect([out.width, out.height]).toEqual([4, 4]);
  });

  it("straightens by rotating content about the centre (90°)", () => {
    const src = img(2, 2);
    const out = applyCrop(src, { rect: FULL, angle: 90 });
    expect([out.width, out.height]).toEqual([2, 2]);
    // A +90° straighten maps output top-left to source bottom-left.
    expect(px(out, 0, 0)).toEqual(px(src, 0, 1));
  });
});
