// Depth Range spec — rangeDepth reads the source's depth channel (not its
// pixels) and bands it exactly like rangeLuminance. Nothing ingests depth yet,
// so the no-channel case (zero coverage) is the one that runs on real photos.

import { describe, expect, it } from "vitest";

import { createMask, type DepthRangeComponent } from "./maskGraph";
import { computeMaskCoverage, type MaskRenderSource } from "./maskRender";

const depthComp = (over: Partial<DepthRangeComponent> = {}): DepthRangeComponent => ({
  kind: "rangeDepth",
  id: "d",
  combine: "add",
  invert: false,
  near: 0,
  far: 0.5,
  smoothness: 0,
  ...over,
});

/** A 4x1 source whose depth ramps 0, 1/3, 2/3, 1 (pixels stay mid-grey so a
 *  luminance read would give a different answer than a depth read). */
const source = (depth?: number[]): MaskRenderSource => ({
  pixels: new Uint8ClampedArray(4 * 4).fill(128),
  width: 4,
  height: 1,
  depth: depth ? new Float32Array(depth) : undefined,
});

const cover = (c: DepthRangeComponent, base?: MaskRenderSource): number[] =>
  Array.from(computeMaskCoverage(createMask("m", "Depth 1", c), 4, 1, base));

describe("rangeDepth coverage", () => {
  it("selects the depth band, hard-edged at zero smoothness", () => {
    const base = source([0, 1 / 3, 2 / 3, 1]);
    expect(cover(depthComp({ near: 0, far: 0.5 }), base)).toEqual([1, 1, 0, 0]);
    expect(cover(depthComp({ near: 0.6, far: 1 }), base)).toEqual([0, 0, 1, 1]);
  });

  it("feathers outside the band by smoothness, and inverts as a component", () => {
    const base = source([0, 1 / 3, 2 / 3, 1]);
    const soft = cover(depthComp({ near: 0, far: 0.5, smoothness: 1 }), base);
    expect(soft[1]).toBe(1); // inside the band
    expect(soft[2]).toBeGreaterThan(0); // 2/3 is within the 0.5-wide ramp
    expect(soft[2]).toBeLessThan(1);
    expect(soft[3]).toBe(0); // 1.0 is past the ramp
    const inv = cover(depthComp({ near: 0, far: 0.5, invert: true }), base);
    expect(inv).toEqual([0, 0, 1, 1]);
  });

  it("defaults absent smoothness to the tool's 0.5 (legacy graphs feather)", () => {
    const base = source([0, 1 / 3, 2 / 3, 1]);
    const c = depthComp();
    delete c.smoothness;
    // 2/3 sits 1/6 past `far`, inside the 0.25-wide default ramp.
    expect(cover(c, base)[2]).toBeGreaterThan(0);
  });

  it("covers nothing without a depth channel — no photo ships one yet", () => {
    expect(cover(depthComp(), source())).toEqual([0, 0, 0, 0]);
    expect(cover(depthComp())).toEqual([0, 0, 0, 0]);
  });

  it("selects nothing when the band is inverted (near > far)", () => {
    expect(cover(depthComp({ near: 0.9, far: 0.1 }), source([0, 0.1, 0.9, 1]))).toEqual([0, 0, 0, 0]);
  });

  it("rejects a depth channel that does not match the source dimensions", () => {
    const bad = { ...source([0, 1]), depth: new Float32Array([0, 1]) };
    expect(() => cover(depthComp(), bad)).toThrow(/depth channel/);
  });
});
