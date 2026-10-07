// Unit tests for the Equalize adjustment. Engine-free (node). These pin the binning
// (must match adjust.rs equalize: bin = (l·255+0.5) as usize, capped 255), the
// min-normalised CDF LUT ((cdf−cdf_min)/(total−cdf_min)), and the defining behaviours:
// a uniform histogram is the identity, a constant image collapses, the mapping is
// monotone, and contrast is stretched to the full range.
import { describe, it, expect } from "vitest";
import { luminance601, binIndex, equalizeLut, equalizeGray, equalizeDelta } from "./equalize";

describe("binIndex", () => {
  it("maps the endpoints and the centre", () => {
    expect(binIndex(0)).toBe(0);
    expect(binIndex(1)).toBe(255);
    expect(binIndex(0.5)).toBe(128); // 0.5·255 + 0.5 = 128.0 → floor 128
  });

  it("rounds half-up at a bin boundary", () => {
    // l just below 1.5/255 → bin 1; the +0.5 in (l·255+0.5) rounds half up
    expect(binIndex(1 / 255)).toBe(1);
    expect(binIndex(2 / 255)).toBe(2);
  });

  it("clamps out-of-range luminance and caps at 255", () => {
    expect(binIndex(-0.3)).toBe(0);
    expect(binIndex(1.7)).toBe(255);
  });

  it("bin(v/255) === v for every 8-bit value (grayscale binning is exact)", () => {
    for (let v = 0; v <= 255; v++) expect(binIndex(Math.fround(v / 255))).toBe(v);
  });

  it("binning a real gray pixel via luminance601 matches the direct bin for every level (engine parity)", () => {
    // The load-bearing parity claim: routing a gray pixel (r=g=b) through the engine's
    // f32 luminance lands in the same bin as binning the raw value — so equalizeGray is
    // a faithful model of the engine's luminance-histogram path on grayscale data.
    for (let v = 0; v <= 255; v++) {
      const c = Math.fround(v / 255);
      expect(binIndex(luminance601(c, c, c))).toBe(v);
    }
  });
});

describe("luminance601", () => {
  it("is the Rec.601 weighted sum", () => {
    expect(luminance601(1, 1, 1)).toBeCloseTo(1, 6);
    expect(luminance601(0, 0, 0)).toBe(0);
    expect(luminance601(1, 0, 0)).toBeCloseTo(0.299, 5);
    expect(luminance601(0, 1, 0)).toBeCloseTo(0.587, 5);
    expect(luminance601(0, 0, 1)).toBeCloseTo(0.114, 5);
  });

  it("is computed in f32 (fround-stable)", () => {
    const l = luminance601(0.2, 0.5, 0.7);
    expect(l).toBe(Math.fround(l));
  });
});

describe("equalizeLut", () => {
  it("returns null for an empty histogram (engine no-op)", () => {
    expect(equalizeLut(new Array(256).fill(0))).toBeNull();
  });

  it("a uniform histogram yields the identity ramp lut[i] = i/255", () => {
    const hist = new Array(256).fill(7); // any equal positive count
    const lut = equalizeLut(hist)!;
    expect(lut).not.toBeNull();
    for (let i = 0; i < 256; i++) expect(lut[i]).toBeCloseTo(i / 255, 6);
  });

  it("is monotonically non-decreasing (it is a normalised CDF)", () => {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < 256; i++) hist[i] = (i * 37 + 11) % 13; // lumpy, some zeros
    hist[0] = 1; // ensure non-empty
    const lut = equalizeLut(hist)!;
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("the lowest occupied bin maps to 0 and the highest to 1 (cdf_min normalisation)", () => {
    const hist = new Array(256).fill(0);
    hist[40] = 10;
    hist[200] = 30;
    const lut = equalizeLut(hist)!;
    expect(lut[40]).toBe(0); // lowest occupied bin → 0 after subtracting cdf_min
    expect(lut[200]).toBe(1); // top of the CDF → 1
    expect(lut[39]).toBe(0); // below the data, cdf=0 → clamped 0
    expect(lut[255]).toBe(1); // at/above the top stays 1
  });

  it("a single occupied bin collapses the whole lut to 0 (degenerate denom)", () => {
    const hist = new Array(256).fill(0);
    hist[128] = 500;
    const lut = equalizeLut(hist)!;
    for (const v of lut) expect(v).toBe(0);
  });

  it("tolerates a short histogram array (missing bins treated as 0)", () => {
    const lut = equalizeLut([0, 0, 5, 0, 5])!; // length 5, rest implicitly 0
    expect(lut).not.toBeNull();
    expect(lut.length).toBe(256);
    expect(lut[2]).toBe(0); // lowest occupied → 0
    expect(lut[4]).toBe(1); // highest occupied → 1
    expect(lut[255]).toBe(1);
  });
});

describe("equalizeGray", () => {
  it("an empty image is returned unchanged", () => {
    expect(equalizeGray([])).toEqual([]);
  });

  it("a perfectly uniform image (each value once) is the identity", () => {
    const values = Array.from({ length: 256 }, (_, i) => i);
    expect(equalizeGray(values)).toEqual(values);
  });

  it("a uniform image at double density is still the identity", () => {
    const values = Array.from({ length: 512 }, (_, i) => i >> 1); // each value twice
    expect(equalizeGray(values)).toEqual(values);
  });

  it("a constant image collapses to black (documented degenerate result)", () => {
    expect(equalizeGray([128, 128, 128, 128])).toEqual([0, 0, 0, 0]);
    expect(equalizeGray([255, 255])).toEqual([0, 0]);
  });

  it("a two-level image is stretched to the extremes", () => {
    // 50 dark + 50 light: the two tones are pushed to the extremes 0 and 255
    const values = [...Array(50).fill(60), ...Array(50).fill(200)];
    const out = equalizeGray(values);
    const lows = out.filter((_, i) => values[i] === 60);
    const highs = out.filter((_, i) => values[i] === 200);
    expect(lows.every((v) => v === 0)).toBe(true);
    expect(highs.every((v) => v === 255)).toBe(true);
  });

  it("stretches a dark, low-contrast cluster across the full range", () => {
    // all values squeezed into [100,130] → output should reach both 0 and 255
    const values: number[] = [];
    for (let v = 100; v <= 130; v++) for (let k = 0; k < 4; k++) values.push(v);
    const out = equalizeGray(values);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(255);
  });

  it("is order-preserving: equal inputs map equally and the mapping is monotone", () => {
    const values = [10, 50, 50, 90, 130, 200, 200, 255];
    const out = equalizeGray(values);
    // monotone: a larger input never produces a smaller output
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
      if (values[i] === values[i - 1]) expect(out[i]).toBe(out[i - 1]);
    }
  });

  it("produces in-range integer bytes and is deterministic", () => {
    const values = Array.from({ length: 400 }, (_, i) => (i * 53 + 17) % 256);
    const out = equalizeGray(values);
    for (const v of out) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    expect(equalizeGray(values)).toEqual(out);
  });

  it("does not mutate the input", () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6];
    const snapshot = [...values];
    equalizeGray(values);
    expect(values).toEqual(snapshot);
  });
});

describe("equalizeDelta (colour-preserving shift)", () => {
  const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : n);
  // Local mirror of the engine's per-pixel apply: add ONE delta to every channel, clamp.
  const applyDelta = (r: number, g: number, b: number, d: number) =>
    [clamp01(r + d), clamp01(g + d), clamp01(b + d)] as const;

  it("returns lut[bin(l)] − l for the pixel's luminance", () => {
    const hist = new Array(256).fill(0);
    hist[0] = 1;
    hist[255] = 1; // lut: bin0→0, bin255→1
    const lut = equalizeLut(hist)!;
    const l = luminance601(0.4, 0.5, 0.6);
    expect(equalizeDelta(lut, 0.4, 0.5, 0.6)).toBeCloseTo(lut[binIndex(l)] - l, 9);
  });

  it("applying the shift to all channels preserves channel differences (hue) and moves brightness", () => {
    // A non-identity lut (midtones lifted by 0.1) so the delta is genuinely nonzero, and a
    // mid-range pixel so no channel clamps — then the equal shift must preserve r−g / g−b.
    const lut = Array.from({ length: 256 }, (_, i) => clamp01(i / 255 + 0.1));
    const [r, g, b] = [0.3, 0.5, 0.7];
    const l = luminance601(r, g, b);
    const d = equalizeDelta(lut, r, g, b);
    expect(d).toBeCloseTo(lut[binIndex(l)] - l, 9);
    expect(Math.abs(d)).toBeGreaterThan(0.01); // the shift is real, not a no-op
    const [r2, g2, b2] = applyDelta(r, g, b, d);
    expect(r2).toBeCloseTo(r + d, 9); // no clamping at these mid values
    expect(r2 - g2).toBeCloseTo(r - g, 9); // hue (channel differences) survives the shift
    expect(g2 - b2).toBeCloseTo(g - b, 9);
    expect((r2 + g2 + b2) / 3 - (r + g + b) / 3).toBeCloseTo(d, 9); // brightness moved by d
  });
});

// ── Several grayscale fixtures: equalize must keep them in range, monotone, and
//    (for non-degenerate inputs) expand or preserve the dynamic range ───────────
const FIXTURES: { name: string; values: number[] }[] = [
  { name: "linear ramp", values: Array.from({ length: 256 }, (_, i) => i) },
  { name: "dark gradient", values: Array.from({ length: 128 }, (_, i) => i) }, // 0..127 only
  { name: "bimodal", values: [...Array(64).fill(40), ...Array(64).fill(210)] },
  { name: "noisy mid", values: Array.from({ length: 300 }, (_, i) => 96 + ((i * 17) % 64)) },
];

describe.each(FIXTURES)("fixture: $name", ({ values }) => {
  it("stays in range, is monotone in the unique input values, and never shrinks the span", () => {
    const out = equalizeGray(values);
    expect(out.length).toBe(values.length);
    for (const v of out) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    // build the unique value→output mapping and assert it is monotone non-decreasing
    const map = new Map<number, number>();
    values.forEach((v, i) => map.set(v, out[i]));
    const keys = [...map.keys()].sort((a, b) => a - b);
    for (let i = 1; i < keys.length; i++) {
      expect(map.get(keys[i])!).toBeGreaterThanOrEqual(map.get(keys[i - 1])!);
    }
    // any multi-tone image is stretched to the full [0,255] range (lowest occupied bin→0,
    // highest→255), so the output span is exactly 255 — never less than the input span.
    if (keys.length > 1) {
      expect(Math.max(...out) - Math.min(...out)).toBe(255);
    }
  });
});
