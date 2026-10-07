// maskRender.colorSample.test — GAL-MASK-11: a Color Range sample is averaged
// over a region, so a single noisy pixel can no longer define the selection, and
// the five-sample cap LR enforces lives with the sampling math.

import { describe, expect, it } from "vitest";

import { createMask, type ColorRangeComponent } from "./maskGraph";
import {
  averageRgbSample,
  computeMaskCoverage,
  MAX_COLOR_RANGE_SAMPLES,
  type MaskRenderSource,
} from "./maskRender";

const rangeComp = (samples: ColorRangeComponent["samples"]): ColorRangeComponent => ({
  kind: "rangeColor",
  id: "c1",
  combine: "add",
  invert: false,
  samples,
  refine: 0,
});

/** A 5x5 patch of mid grey with one blown-out pixel — what a click near a
 *  specular highlight or a hot pixel actually lands on. */
function noisyGreyPatch(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(25 * 4);
  for (let i = 0; i < 25; i++) {
    px.set([128, 128, 128, 255], i * 4);
  }
  px.set([255, 255, 255, 255], 12 * 4); // the centre pixel is the outlier
  return px;
}

describe("averageRgbSample (GAL-MASK-11)", () => {
  it("averages a patch into normalized rgb", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(averageRgbSample(px)).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it("returns black for an empty buffer rather than NaN", () => {
    expect(averageRgbSample(new Uint8ClampedArray(0))).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("selects the grey region the click was over, where the single pixel does not", () => {
    // One grey pixel of the same subject the patch covered.
    const base: MaskRenderSource = {
      pixels: new Uint8ClampedArray([128, 128, 128, 255]),
      width: 1,
      height: 1,
    };
    const patch = noisyGreyPatch();
    const single = { r: patch[48] / 255, g: patch[49] / 255, b: patch[50] / 255 }; // the outlier
    const averaged = averageRgbSample(patch);

    const cover = (s: ColorRangeComponent["samples"][number]) =>
      computeMaskCoverage(createMask("m1", "Color 1", rangeComp([s])), 1, 1, base)[0];

    expect(cover(single)).toBe(0); // white sample misses grey entirely
    expect(cover(averaged)).toBeGreaterThan(0.5); // the outlier only nudges it
  });
});

describe("MAX_COLOR_RANGE_SAMPLES", () => {
  it("matches LR's five-sample ceiling", () => {
    expect(MAX_COLOR_RANGE_SAMPLES).toBe(5);
  });
});
