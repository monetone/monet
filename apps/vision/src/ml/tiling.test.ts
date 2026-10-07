import { describe, expect, it, vi } from "vitest";
import { tileFilter, tileOrigins } from "./tiling";

describe("native-resolution ML tiling", () => {
  it("clamps the final origin instead of emitting partial tiles", () => {
    expect(tileOrigins(0, 256, 32)).toEqual([]);
    expect(tileOrigins(100, 256, 32)).toEqual([0]);
    expect(tileOrigins(600, 256, 32)).toEqual([0, 224, 344]);
  });

  it("edge-pads image and mask planes", async () => {
    const data = new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
    ]);
    const run = vi.fn(async ({ img, mask }: { img: Float32Array; mask: Float32Array | null }) => {
      expect(Array.from(img.slice(0, 9))).toEqual(Array.from(Float32Array.from([
        10 / 255, 40 / 255, 40 / 255,
        10 / 255, 40 / 255, 40 / 255,
        10 / 255, 40 / 255, 40 / 255,
      ])));
      expect(Array.from(mask!)).toEqual([0, 1, 1, 0, 1, 1, 0, 1, 1]);
      return img;
    });

    const { rgba, tiles } = await tileFilter(data, 2, 1, run, {
      tile: 3,
      overlap: 1,
      mask: new Uint8Array([0, 255]),
    });

    expect(tiles).toBe(1);
    expect(run).toHaveBeenCalledOnce();
    expect(Array.from(rgba)).toEqual(Array.from(data));
  });

  it("normalizes pixels shared by overlapping tiles", async () => {
    const data = new Uint8ClampedArray(5 * 4);
    let tile = 0;
    const { rgba, tiles } = await tileFilter(data, 5, 1, async ({ img }) => {
      img.fill(tile++);
      return img;
    }, { tile: 3, overlap: 1 });

    expect(tiles).toBe(2);
    expect(Array.from(rgba)).toEqual([
      0, 0, 0, 255,
      0, 0, 0, 255,
      128, 128, 128, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
  });
});
