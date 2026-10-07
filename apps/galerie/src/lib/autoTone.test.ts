import { describe, expect, it } from "vitest";

import { autoTone } from "./autoTone";

/** A histogram with all its mass at one luma level. */
const spike = (level: number, n = 1000): number[] => {
  const c = new Array<number>(256).fill(0);
  c[level] = n;
  return c;
};

describe("autoTone", () => {
  it("is neutral for an empty histogram", () => {
    expect(autoTone(new Array<number>(256).fill(0))).toEqual({
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
    });
  });

  it("brightens a dark image and darkens a bright one", () => {
    expect(autoTone(spike(30)).exposure).toBeGreaterThan(0);
    expect(autoTone(spike(220)).exposure).toBeLessThan(0);
  });

  it("clamps exposure to the ±4-stop domain at the extremes", () => {
    expect(autoTone(spike(0)).exposure).toBeGreaterThan(0);
    expect(autoTone(spike(0)).exposure).toBeLessThanOrEqual(4);
    expect(autoTone(spike(255)).exposure).toBeGreaterThanOrEqual(-4);
  });

  it("adds contrast to a flat image and pulls it down for a high-contrast one", () => {
    expect(autoTone(spike(128)).contrast).toBeGreaterThan(0); // std 0 → boost
    const bimodal = new Array<number>(256).fill(0);
    bimodal[0] = 500;
    bimodal[255] = 500; // std ≈ 128 → reduce
    expect(autoTone(bimodal).contrast).toBeLessThan(0);
  });

  it("keeps every result inside the Basic slider domain", () => {
    for (const lvl of [0, 30, 128, 200, 255]) {
      const { exposure, contrast, highlights, shadows, whites, blacks } = autoTone(spike(lvl));
      expect(exposure).toBeGreaterThanOrEqual(-4);
      expect(exposure).toBeLessThanOrEqual(4);
      expect(contrast).toBeGreaterThanOrEqual(-0.25);
      expect(contrast).toBeLessThanOrEqual(0.4);
      expect(whites).toBeGreaterThanOrEqual(-0.5);
      expect(whites).toBeLessThanOrEqual(0.5);
      expect(blacks).toBeGreaterThanOrEqual(-0.5);
      expect(blacks).toBeLessThanOrEqual(0.5);
      expect(highlights).toBeGreaterThanOrEqual(-0.5);
      expect(highlights).toBeLessThanOrEqual(0);
      expect(shadows).toBeGreaterThanOrEqual(0);
      expect(shadows).toBeLessThanOrEqual(0.5);
    }
  });

  it("anchors the endpoints: lifts whites on a dim top, deepens blacks on a raised floor", () => {
    // An image whose brightest tones sit at 30 has no near-white → positive whites,
    // and no true black (floor at 30) → negative blacks.
    const dim = autoTone(spike(30));
    expect(dim.whites).toBeGreaterThan(0);
    expect(dim.blacks).toBeLessThan(0);
    // A full-range image (mass at both ends) needs almost no endpoint anchoring.
    const wide = new Array<number>(256).fill(0);
    wide[1] = 500;
    wide[254] = 500;
    expect(Math.abs(autoTone(wide).whites)).toBeLessThan(0.1);
    expect(Math.abs(autoTone(wide).blacks)).toBeLessThan(0.1);
  });

  it("recovers near-white clipping and opens near-black clipping", () => {
    expect(autoTone(spike(255)).highlights).toBeLessThan(0); // blown highlights → recover
    expect(autoTone(spike(0)).shadows).toBeGreaterThan(0); // crushed shadows → open
    // A mid-tone-only image clips neither end.
    expect(autoTone(spike(128)).highlights).toBe(0);
    expect(autoTone(spike(128)).shadows).toBe(0);
  });
});
