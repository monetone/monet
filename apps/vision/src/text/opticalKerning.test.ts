import { describe, it, expect } from "vitest";
import { outlineKernEm, opticalKerningEm, kerningDelta, type GlyphInk } from "./raster";

// Synthetic ink profiles (em units, 40 scanlines top→bottom): rows 0-9 are the
// cap band, 10-29 the x-height band, 30+ below the baseline. Real profiles come
// off a canvas, which the node unit env has no access to — the geometry these
// feed is the part that decides the kern.
const ROWS = 40;
function ink(advance: number, span: (y: number) => [number, number] | null): GlyphInk {
  const left = new Float32Array(ROWS).fill(NaN);
  const right = new Float32Array(ROWS).fill(NaN);
  for (let y = 0; y < ROWS; y++) {
    const s = span(y);
    if (s) { left[y] = s[0]; right[y] = s[1]; }
  }
  return { advance, left, right };
}

const inBand = (y: number, lo: number, hi: number) => y >= lo && y <= hi;

// A flat-sided "n": even 0.08em sidebearings, so the neutral gap is 0.16em.
const nLike = ink(0.6, (y) => (inBand(y, 10, 29) ? [0.08, 0.52] : null));
// A "T": crossbar spans the full width up top, bare stem down the x-height band.
const tLike = ink(0.6, (y) => (inBand(y, 0, 3) ? [0.02, 0.58] : inBand(y, 4, 29) ? [0.27, 0.33] : null));
// A round "o", x-height only.
const oLike = ink(0.55, (y) => (inBand(y, 10, 29) ? [0.05, 0.50] : null));
// An "r": the arm reaches out to the advance for three rows, stem below.
const rLike = ink(0.4, (y) => (inBand(y, 10, 12) ? [0.08, 0.39] : inBand(y, 13, 29) ? [0.08, 0.14] : null));
// A "." — ink only on the baseline rows.
const dotLike = ink(0.3, (y) => (inBand(y, 27, 29) ? [0.09, 0.21] : null));

const NEUTRAL = 0.16;

describe("outlineKernEm", () => {
  it("leaves a flat-sided pair alone (it defines the neutral gap)", () => {
    expect(outlineKernEm(nLike, nLike, NEUTRAL)).toBeCloseTo(0, 6);
  });

  it("tightens T+o from the shape, not from a Latin lookup", () => {
    // Shared band is the x-height, where T is only its stem: gap 0.32em, capped
    // to 1.5×neutral = 0.24 → kern 0.16 - 0.24.
    expect(outlineKernEm(tLike, oLike, NEUTRAL)).toBeCloseTo(-0.08, 6);
  });

  it("tightens a stem before a low dot", () => {
    // Baseline rows only, where the T's stem sits far from the dot.
    expect(outlineKernEm(tLike, dotLike, NEUTRAL)).toBeCloseTo(-0.08, 6);
  });

  it("never closes the pair below the collision floor", () => {
    // r's arm nearly touches o already; the mean says tighten, the floor says how far.
    const k = outlineKernEm(rLike, oLike, NEUTRAL)!;
    const closestGap = (0.4 - 0.39) + 0.05;
    expect(k).toBeCloseTo(-(closestGap - 0.015), 6);
    expect(closestGap + k).toBeCloseTo(0.015, 6); // profiles are Float32, so exact-≥ is too tight
  });

  it("declines to judge a pair whose inks never share a scanline", () => {
    const high = ink(0.5, (y) => (inBand(y, 0, 5) ? [0.05, 0.45] : null));
    expect(outlineKernEm(high, dotLike, NEUTRAL)).toBeNull();
  });

  it("is script-agnostic: a full-width square glyph stays put", () => {
    const cjk = ink(1, (y) => (inBand(y, 2, 34) ? [0.06, 0.94] : null));
    // Gap 0.12em vs a 0.16em neutral → a hair of positive kern, never a crush.
    const k = outlineKernEm(cjk, cjk, NEUTRAL)!;
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(0.05);
  });
});

describe("opticalKerningEm fallback", () => {
  it("uses the Latin pair classes when no font is given (no canvas to sample)", () => {
    expect(opticalKerningEm("T", "o")).toBeLessThan(0);
    expect(opticalKerningEm("H", "n")).toBe(0);
    expect(opticalKerningEm("T", " ")).toBe(0);
  });

  it("keeps the same fallback in node, where the ink canvas is unavailable", () => {
    expect(opticalKerningEm("A", "V", "400 24px serif")).toBe(opticalKerningEm("A", "V"));
    expect(kerningDelta("A", "V", 80, "optical", 0, "400 24px serif")).toBeLessThan(-1);
  });
});
