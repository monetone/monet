import { describe, it, expect } from "vitest";
import {
  MAX_CUBE_LUT_IMPORT_BYTES,
  MAX_CUBE_LUT_SIZE,
  parseCubeLut,
  parse3dlLut,
  sampleLut3D,
  applyCubeLut,
} from "./cubeLut";

describe("parse3dlLut", () => {
  // Identity 2³ LUT, 10-bit outputs, blue varying fastest (file order).
  const identity3dl = [
    "# Autodesk 3DL",
    "3DMESH",
    "0 1023",
    "0 0 0",
    "0 0 1023",
    "0 1023 0",
    "0 1023 1023",
    "1023 0 0",
    "1023 0 1023",
    "1023 1023 0",
    "1023 1023 1023",
  ].join("\n");

  it("parses a .3dl and re-packs blue-fastest file order to red-fastest", () => {
    const lut = parse3dlLut(identity3dl)!;
    expect(lut.size).toBe(2);
    expect(sampleLut3D(lut, 1, 0, 0).map((v) => Math.round(v * 1023))).toEqual([1023, 0, 0]);
    expect(sampleLut3D(lut, 0, 0, 1).map((v) => Math.round(v * 1023))).toEqual([0, 0, 1023]);
  });

  it("detects channel order via an asymmetric LUT", () => {
    // Output encodes the INPUT coordinate per channel: (r·1000, g·100, b·10).
    const lines: string[] = ["0 1023"];
    for (let r = 0; r < 2; r++) for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) lines.push(`${r * 1000} ${g * 100} ${b * 10}`);
    const lut = parse3dlLut(lines.join("\n"))!;
    const [or, og, ob] = sampleLut3D(lut, 1, 0, 1).map((v) => Math.round(v * 1023));
    expect([or, og, ob]).toEqual([1000, 0, 10]); // red + blue set, green not
  });

  it("normalises by the smallest standard full-scale that holds the data", () => {
    const twelveBit = ["0 4095", ...Array.from({ length: 8 }, () => "4095 0 0")].join("\n");
    const lut = parse3dlLut(twelveBit)!;
    expect(sampleLut3D(lut, 0, 0, 0)[0]).toBeCloseTo(1, 5);
  });

  it("rejects non-.3dl input", () => {
    expect(parse3dlLut("LUT_3D_SIZE 2\n0 0 0\n1 1 1")).toBeNull(); // .cube text
    expect(parse3dlLut("0 1023\n0 0 0")).toBeNull(); // truncated data
    expect(parse3dlLut("1 2 3\n0 0 0")).toBeNull(); // 3-value mesh is ambiguous → rejected
    expect(parse3dlLut("")).toBeNull();
  });
});

/** Build a size-2 .cube whose corner (ri,gi,bi) outputs f(ri,gi,bi) (0/1 args). */
function cube2(f: (r: number, g: number, b: number) => [number, number, number], extra = ""): string {
  let s = `TITLE "test"\nLUT_3D_SIZE 2\n${extra}`;
  for (let bi = 0; bi < 2; bi++) for (let gi = 0; gi < 2; gi++) for (let ri = 0; ri < 2; ri++) {
    const [r, g, b] = f(ri, gi, bi);
    s += `${r} ${g} ${b}\n`;
  }
  return s;
}

const IDENTITY = (r: number, g: number, b: number): [number, number, number] => [r, g, b];
const INVERT = (r: number, g: number, b: number): [number, number, number] => [1 - r, 1 - g, 1 - b];
const SWAP_RB = (r: number, g: number, b: number): [number, number, number] => [b, g, r];

describe("parseCubeLut", () => {
  it("parses size, default domain and N³ data", () => {
    const lut = parseCubeLut(cube2(IDENTITY))!;
    expect(lut.size).toBe(2);
    expect(lut.data.length).toBe(2 * 2 * 2 * 3);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it("reads DOMAIN_MIN/MAX when present", () => {
    const lut = parseCubeLut(cube2(IDENTITY, "DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n"))!;
    expect(lut.domainMax).toEqual([2, 2, 2]);
    // input 1.0 sits at the domain midpoint → identity output ≈ 0.5
    const [r] = sampleLut3D(lut, 1, 1, 1);
    expect(r).toBeCloseTo(0.5, 5);
  });

  it("returns null for 1D LUTs, bad sizes and truncated data", () => {
    expect(parseCubeLut("LUT_1D_SIZE 32\n0 0 0\n1 1 1\n")).toBeNull();
    expect(parseCubeLut("LUT_3D_SIZE 1\n0 0 0\n")).toBeNull();       // size < 2
    expect(parseCubeLut("LUT_3D_SIZE 2\n0 0 0\n1 1 1\n")).toBeNull(); // only 2 of 8 rows
    expect(parseCubeLut("not a lut\n")).toBeNull();
    expect(parseCubeLut("")).toBeNull();
  });

  it("ignores comments and blank lines", () => {
    const withNoise = "# a comment\n\n" + cube2(IDENTITY) + "\n# trailing\n";
    expect(parseCubeLut(withNoise)!.size).toBe(2);
  });

  it("rejects byte and grid ceilings before line/value accumulation", () => {
    const oversized = { length: MAX_CUBE_LUT_IMPORT_BYTES + 1 } as unknown as string;
    expect(parseCubeLut(oversized)).toBeNull();
    expect(parseCubeLut(`LUT_3D_SIZE ${MAX_CUBE_LUT_SIZE + 1}\n`)).toBeNull();
  });
});

describe("sampleLut3D", () => {
  it("is exact for an identity LUT (trilinear over the unit cube)", () => {
    const lut = parseCubeLut(cube2(IDENTITY))!;
    const [r, g, b] = sampleLut3D(lut, 0.5, 0.25, 0.75);
    expect(r).toBeCloseTo(0.5, 5); expect(g).toBeCloseTo(0.25, 5); expect(b).toBeCloseTo(0.75, 5);
  });

  it("inverts", () => {
    const lut = parseCubeLut(cube2(INVERT))!;
    const [r, g, b] = sampleLut3D(lut, 0.2, 0.4, 0.6);
    expect(r).toBeCloseTo(0.8, 5); expect(g).toBeCloseTo(0.6, 5); expect(b).toBeCloseTo(0.4, 5);
  });

  it("swaps R↔B (proves the red-fastest indexing is not transposed)", () => {
    const lut = parseCubeLut(cube2(SWAP_RB))!;
    const [r, g, b] = sampleLut3D(lut, 0.1, 0.5, 0.9);
    expect(r).toBeCloseTo(0.9, 5); expect(g).toBeCloseTo(0.5, 5); expect(b).toBeCloseTo(0.1, 5);
  });

  it("clamps out-of-range inputs to the grid", () => {
    const lut = parseCubeLut(cube2(IDENTITY))!;
    expect(sampleLut3D(lut, -1, 2, 0.5)).toEqual([0, 1, 0.5]);
  });
});

describe("applyCubeLut", () => {
  it("inverts an RGBA buffer and preserves alpha", () => {
    const lut = parseCubeLut(cube2(INVERT))!;
    const out = applyCubeLut(lut, new Uint8Array([255, 0, 0, 128, 0, 128, 255, 200]));
    expect(Array.from(out)).toEqual([0, 255, 255, 128, 255, 127, 0, 200]);
  });

  it("swaps channels via the swap LUT", () => {
    const lut = parseCubeLut(cube2(SWAP_RB))!;
    const out = applyCubeLut(lut, new Uint8Array([255, 0, 0, 255]));
    expect(Array.from(out)).toEqual([0, 0, 255, 255]);
  });

  it("leaves pixels ~unchanged under identity", () => {
    const lut = parseCubeLut(cube2(IDENTITY))!;
    const out = applyCubeLut(lut, new Uint8Array([10, 128, 240, 255]));
    expect(Array.from(out)).toEqual([10, 128, 240, 255]);
  });
});
