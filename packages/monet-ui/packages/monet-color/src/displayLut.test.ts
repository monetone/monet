import { describe, expect, it } from "vitest";
import { DISPLAY_LUT_SIZE, lutSizeFor, proofLutSizeFor, sampleDisplayLut, sampleProofLut } from "./displayLut";

/** Build a LUT whose entry at lattice (r,g,b) is `fn(rv,gv,bv)` of the 8-bit
 *  lattice axis values — mirrors the engine's packing (R fastest, then G, B). */
function buildLut(n: number, fn: (r: number, g: number, b: number) => [number, number, number]): Uint8Array {
  const lut = new Uint8Array(n * n * n * 3);
  let o = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++, o += 3) {
        const [rv, gv, bv] = fn(
          Math.round((r * 255) / (n - 1)),
          Math.round((g * 255) / (n - 1)),
          Math.round((b * 255) / (n - 1)),
        );
        lut[o] = rv; lut[o + 1] = gv; lut[o + 2] = bv;
      }
    }
  }
  return lut;
}

describe("displayLut", () => {
  it("recovers the lattice size from a packed LUT length", () => {
    expect(lutSizeFor(new Uint8Array(DISPLAY_LUT_SIZE ** 3 * 3))).toBe(DISPLAY_LUT_SIZE);
    expect(lutSizeFor(new Uint8Array(9 * 9 * 9 * 3))).toBe(9);
    expect(lutSizeFor(new Uint8Array(0))).toBeNull();
    expect(lutSizeFor(new Uint8Array(100))).toBeNull();
  });

  it("an identity LUT reproduces its input", () => {
    const n = 9;
    const lut = buildLut(n, (r, g, b) => [r, g, b]);
    // Exact at lattice points…
    expect(sampleDisplayLut(lut, n, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(sampleDisplayLut(lut, n, 255, 255, 255)).toEqual([255, 255, 255]);
    // …and within rounding error everywhere else.
    for (const [r, g, b] of [[13, 87, 200], [255, 0, 128], [1, 254, 3], [128, 128, 128]]) {
      const [or, og, ob] = sampleDisplayLut(lut, n, r, g, b);
      expect(Math.abs(or - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(og - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(ob - b)).toBeLessThanOrEqual(1);
    }
  });

  it("interpolates trilinearly between lattice points", () => {
    // n=2: entries are the cube corners; the midpoint must be the mean.
    const lut = buildLut(2, (r, g, b) => [r, g, b]);
    expect(sampleDisplayLut(lut, 2, 127.5, 127.5, 127.5).map(Math.round)).toEqual([128, 128, 128]);
  });

  it("applies a channel-swapping LUT", () => {
    const n = 9;
    const lut = buildLut(n, (r, g, b) => [b, g, r]);
    const [or, og, ob] = sampleDisplayLut(lut, n, 10, 20, 30);
    expect(Math.abs(or - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(og - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(ob - 10)).toBeLessThanOrEqual(1);
  });
});

/** Build a 4-channel proof LUT from lattice-value functions. */
function buildProofLut(n: number, fn: (r: number, g: number, b: number) => [number, number, number, number]): Uint8Array {
  const lut = new Uint8Array(n * n * n * 4);
  let o = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++, o += 4) {
        const [rv, gv, bv, k] = fn(
          Math.round((r * 255) / (n - 1)),
          Math.round((g * 255) / (n - 1)),
          Math.round((b * 255) / (n - 1)),
        );
        lut[o] = rv; lut[o + 1] = gv; lut[o + 2] = bv; lut[o + 3] = k;
      }
    }
  }
  return lut;
}

describe("proof LUT sampling", () => {
  it("recovers the proof lattice size (n³·4)", () => {
    expect(proofLutSizeFor(new Uint8Array(9 * 9 * 9 * 4))).toBe(9);
    expect(proofLutSizeFor(new Uint8Array(9 * 9 * 9 * 3))).toBeNull();
  });

  it("interpolates RGB and snaps the gamut flag to the nearest lattice point", () => {
    // Identity RGB; gamut flagged only where red ≥ 192.
    const n = 9;
    const lut = buildProofLut(n, (r, g, b) => [r, g, b, r >= 192 ? 255 : 0]);
    const [r, g, b, flag] = sampleProofLut(lut, n, 100, 50, 200);
    expect(Math.abs(r - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 200)).toBeLessThanOrEqual(1);
    expect(flag).toBe(0);
    expect(sampleProofLut(lut, n, 255, 0, 0)[3]).toBe(255); // deep in the flagged zone
    expect(sampleProofLut(lut, n, 0, 0, 0)[3]).toBe(0);
    // The flag is binary — never an interpolated in-between value.
    const mid = sampleProofLut(lut, n, 191, 10, 10)[3];
    expect(mid === 0 || mid === 255).toBe(true);
  });
});
