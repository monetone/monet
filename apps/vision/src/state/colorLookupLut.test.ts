// #441: a Color Lookup adjustment layer can point at a loaded .cube/.3dl. The
// table travels in the layer's kind-16 params in the exact layout the engine's
// `lut3d_pixel` reads — a header of [-1, N, domain min, domain max] and then the
// parser's red-fastest triplets, untouched.
import { describe, expect, it } from "vitest";
import { parseCubeLut } from "@monet-ui/monet-photo";
import { COLOR_LUT_MARKER, isColorLutParams, packColorLut } from "./colorLookupLut";

const INVERT_2 = [
  "TITLE \"invert\"",
  "LUT_3D_SIZE 2",
  "DOMAIN_MIN 0 0 0",
  "DOMAIN_MAX 1 1 1",
  "1 1 1", "0 1 1", "1 0 1", "0 0 1",
  "1 1 0", "0 1 0", "1 0 0", "0 0 0",
].join("\n");

describe("packColorLut (#441)", () => {
  it("packs the engine's kind-16 external-LUT layout: marker, size, domain, red-fastest data", () => {
    const lut = parseCubeLut(INVERT_2);
    expect(lut).not.toBeNull();
    const p = packColorLut(lut!);
    expect(p).toBeInstanceOf(Float32Array);
    expect(Array.from(p.subarray(0, 8))).toEqual([COLOR_LUT_MARKER, 2, 0, 0, 0, 1, 1, 1]);
    expect(p.length).toBe(8 + 2 * 2 * 2 * 3);
    expect(Array.from(p.subarray(8, 11))).toEqual([1, 1, 1]); // (0,0,0) → white
    expect(Array.from(p.subarray(8 + 7 * 3))).toEqual([0, 0, 0]); // (1,1,1) → black
    expect(Array.from(p.subarray(8 + 1 * 3, 8 + 2 * 3))).toEqual([0, 1, 1]); // red varies fastest
  });

  it("carries a non-unit DOMAIN so the engine rescales inputs like the parser's sampler", () => {
    const lut = parseCubeLut(INVERT_2.replace("DOMAIN_MAX 1 1 1", "DOMAIN_MAX 2 4 8"))!;
    expect(Array.from(packColorLut(lut).subarray(5, 8))).toEqual([2, 4, 8]);
  });

  it("tells a packed LUT apart from a preset id", () => {
    expect(isColorLutParams(packColorLut(parseCubeLut(INVERT_2)!))).toBe(true);
    expect(isColorLutParams([1])).toBe(false);
    expect(isColorLutParams([0])).toBe(false);
    expect(isColorLutParams([COLOR_LUT_MARKER, 2])).toBe(false); // header without a table
  });
});
