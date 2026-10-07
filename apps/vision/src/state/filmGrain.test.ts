// Unit tests for the Film Grain filter. Engine-free (node). It reuses Add Noise's seeded
// xorshift32 (so "random" is deterministic); these tests focus on the grain-specific
// logic — amplitude, threshold, and the highlight-protection curve — plus the integrated
// behaviour: grain fades out in the highlights, neutrals stay neutral, grain=0 is the
// identity, and alpha is untouched. Must match filters.rs film_grain.
import { describe, it, expect } from "vitest";
import {
  lumaU16,
  grainAmplitude,
  grainThreshold,
  highlightProtect,
  grainDelta,
  applyFilmGrainPixel,
  filmGrain,
} from "./filmGrain";
import { makeXorshift32, noiseValue, applyNoiseChannel, NOISE_MAX } from "./addNoise";

describe("lumaU16 (Rec.601 on raw u16)", () => {
  it("maps black to 0 and white to ≈65535", () => {
    expect(lumaU16(0, 0, 0)).toBe(0);
    expect(Math.abs(lumaU16(NOISE_MAX, NOISE_MAX, NOISE_MAX) - NOISE_MAX)).toBeLessThan(2);
  });

  it("weights green > red > blue", () => {
    const r = lumaU16(NOISE_MAX, 0, 0);
    const g = lumaU16(0, NOISE_MAX, 0);
    const b = lumaU16(0, 0, NOISE_MAX);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
    expect(r).toBeCloseTo(0.299 * NOISE_MAX, -1);
  });
});

describe("grainAmplitude", () => {
  it("is grain·(0.08 + 0.12·intensity)·65535", () => {
    expect(grainAmplitude(0, 1)).toBe(0);
    expect(grainAmplitude(1, 1)).toBeCloseTo(0.2 * NOISE_MAX, 0); // (0.08+0.12)·65535
    expect(grainAmplitude(1, 0)).toBeCloseTo(0.08 * NOISE_MAX, 0);
    expect(grainAmplitude(0.5, 0.5)).toBeCloseTo(0.5 * 0.14 * NOISE_MAX, 0);
  });

  it("clamps intensity to [0,1] and grows with both inputs", () => {
    expect(grainAmplitude(1, 5)).toBe(grainAmplitude(1, 1));
    expect(grainAmplitude(1, -1)).toBe(grainAmplitude(1, 0));
    expect(grainAmplitude(1, 1)).toBeGreaterThan(grainAmplitude(1, 0));
    expect(grainAmplitude(1, 0.5)).toBeGreaterThan(grainAmplitude(0.5, 0.5));
  });
});

describe("grainThreshold", () => {
  it("is (1 − highlight)·65535, clamped", () => {
    expect(grainThreshold(0)).toBeCloseTo(NOISE_MAX, 0); // no protection
    expect(grainThreshold(1)).toBe(0); // fully gated from black
    expect(grainThreshold(0.5)).toBeCloseTo(0.5 * NOISE_MAX, 0);
    expect(grainThreshold(2)).toBe(0); // clamp high
    expect(grainThreshold(-1)).toBeCloseTo(NOISE_MAX, 0); // clamp low
  });
});

describe("highlightProtect", () => {
  it("with no protection (thresh = 65535) is 1 everywhere", () => {
    const t = grainThreshold(0);
    for (const luma of [0, 16000, 32768, 50000, NOISE_MAX]) expect(highlightProtect(luma, t)).toBe(1);
  });

  it("with full protection (thresh = 0) ramps linearly from 1 at black to 0 at white", () => {
    const t = grainThreshold(1); // 0
    expect(highlightProtect(0, t)).toBe(1); // luma ≤ thresh
    expect(highlightProtect(NOISE_MAX, t)).toBe(0); // white → no grain
    expect(highlightProtect(NOISE_MAX / 2, t)).toBeCloseTo(0.5, 5);
  });

  it("at a mid threshold, full grain below and a ramp above", () => {
    const t = grainThreshold(0.5); // 32767.5
    expect(highlightProtect(t, t)).toBe(1); // at the threshold (luma ≤ thresh branch)
    expect(highlightProtect(20000, t)).toBe(1); // below → full
    expect(highlightProtect(NOISE_MAX, t)).toBe(0); // white → none
    expect(highlightProtect((t + NOISE_MAX) / 2, t)).toBeCloseTo(0.5, 4); // halfway above
  });

  it("is continuous at the threshold and monotonically non-increasing in luma", () => {
    const t = grainThreshold(0.6);
    let prev = Infinity;
    for (let luma = 0; luma <= NOISE_MAX; luma += 2048) {
      const p = highlightProtect(luma, t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(prev + 1e-6); // never increases as luma grows
      prev = p;
    }
  });

  it("guards the divisor at 1 when the threshold sits just below white", () => {
    // highlight just above 0 → thresh ∈ (65534, 65535); (65535 − thresh) < 1 → max(·,1)=1,
    // so white still yields protect (65535−65535)/1 = 0 with no divide-by-zero.
    const t = grainThreshold(0.00001);
    expect(t).toBeGreaterThan(65534);
    expect(t).toBeLessThan(NOISE_MAX);
    expect(highlightProtect(NOISE_MAX, t)).toBe(0);
    expect(Number.isFinite(highlightProtect(NOISE_MAX, t))).toBe(true);
  });
});

describe("grainDelta", () => {
  it("zeroes out when any factor is zero", () => {
    expect(grainDelta(0, 13107, 1, 1)).toBe(0); // no noise
    expect(grainDelta(1, 0, 1, 1)).toBe(0); // no amplitude
    expect(grainDelta(1, 13107, 0, 1)).toBe(0); // fully protected (highlight)
    expect(grainDelta(1, 13107, 1, 0)).toBe(0); // no coverage
  });

  it("scales with noise, amplitude, protection, and coverage", () => {
    expect(grainDelta(1, 10000, 1, 1)).toBeCloseTo(10000, 0);
    expect(grainDelta(1, 10000, 0.5, 1)).toBeCloseTo(5000, 0);
    expect(grainDelta(-1, 10000, 1, 0.5)).toBeCloseTo(-5000, 0);
  });
});

describe("applyFilmGrainPixel", () => {
  const amt = grainAmplitude(1, 1);

  it("grain 0 (amt 0) is the identity", () => {
    expect(applyFilmGrainPixel(makeXorshift32(5), 111, 222, 333, 0, grainThreshold(0))).toEqual({
      r: 111,
      g: 222,
      b: 333,
    });
  });

  it("monochromatic: a neutral pixel stays neutral", () => {
    const out = applyFilmGrainPixel(makeXorshift32(7), 30000, 30000, 30000, amt, grainThreshold(0.3));
    expect(out.r).toBe(out.g);
    expect(out.g).toBe(out.b);
  });

  it("a pure-white pixel is fully protected when highlight = 1 (no grain)", () => {
    const white = applyFilmGrainPixel(makeXorshift32(7), NOISE_MAX, NOISE_MAX, NOISE_MAX, amt, grainThreshold(1));
    expect(white).toEqual({ r: NOISE_MAX, g: NOISE_MAX, b: NOISE_MAX });
  });

  it("a mid-gray pixel receives the protected grain (protect ≈ 0.5) when highlight = 1", () => {
    const mid = Math.round(NOISE_MAX / 2);
    const thresh = grainThreshold(1);
    const protect = highlightProtect(lumaU16(mid, mid, mid), thresh);
    expect(protect).toBeGreaterThan(0.4); // mid is only half-protected, unlike white (0)
    expect(protect).toBeLessThan(0.6);
    // the pixel applies the shared mono delta scaled by that protect factor
    const d = grainDelta(noiseValue(makeXorshift32(7)()), grainAmplitude(1, 1), protect, 1);
    expect(applyFilmGrainPixel(makeXorshift32(7), mid, mid, mid, amt, thresh).r).toBe(
      applyNoiseChannel(mid, d),
    );
  });

  it("protects a chromatic pixel by its Rec.601 luma (not channel average or max)", () => {
    const [r, g, b] = [5000, 60000, 5000]; // green-heavy
    const thresh = grainThreshold(0.5); // 32767.5
    const protect = highlightProtect(lumaU16(r, g, b), thresh);
    // luma ≈ 37285 → protect ≈ 0.862; the channel average (23333) would give 1, the
    // channel max (60000) ≈ 0.169 — so this pins that protection uses the weighted luma.
    expect(protect).toBeGreaterThan(0.85);
    expect(protect).toBeLessThan(0.88);
    // and the grain is the shared mono delta scaled by that luma-derived protect
    const d = grainDelta(noiseValue(makeXorshift32(7)()), amt, protect, 1);
    expect(applyFilmGrainPixel(makeXorshift32(7), r, g, b, amt, thresh)).toEqual({
      r: applyNoiseChannel(r, d),
      g: applyNoiseChannel(g, d),
      b: applyNoiseChannel(b, d),
    });
  });
});

describe("filmGrain (flat u16 RGBA buffer)", () => {
  const grayBuf = () => [30000, 30000, 30000, 65535, 12000, 12000, 12000, 65535, 50000, 50000, 50000, 65535];
  const fill = (v: number): number[] =>
    [v, v, v, 65535, v, v, v, 65535, v, v, v, 65535, v, v, v, 65535];

  it("grain 0 returns an identical buffer (a fresh copy)", () => {
    const src = grayBuf();
    const out = filmGrain(src, 0, 0.5, 0.5, 999);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it("leaves the alpha channel untouched", () => {
    const src = grayBuf();
    const out = filmGrain(src, 1, 0.2, 1, 4242);
    expect(out[3]).toBe(src[3]);
    expect(out[7]).toBe(src[7]);
    expect(out[11]).toBe(src[11]);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    const src = grayBuf();
    expect(filmGrain(src, 1, 0.3, 0.8, 2024)).toEqual(filmGrain(src, 1, 0.3, 0.8, 2024));
    expect(filmGrain(src, 1, 0.3, 0.8, 2024)).not.toEqual(filmGrain(src, 1, 0.3, 0.8, 7777));
  });

  it("keeps every channel a neutral, in-range value (monochromatic grain)", () => {
    const out = filmGrain(grayBuf(), 1, 0.4, 1, 314);
    for (let p = 0; p < out.length; p += 4) {
      expect(out[p]).toBe(out[p + 1]);
      expect(out[p + 1]).toBe(out[p + 2]);
      for (const v of [out[p], out[p + 1], out[p + 2]]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(NOISE_MAX);
      }
    }
  });

  it("protects the highlights: a white buffer grains at highlight 0 but not at highlight 1", () => {
    const white = fill(NOISE_MAX);
    expect(filmGrain(white, 1, 0, 1, 55)).not.toEqual(white); // no protection → grain hits white
    expect(filmGrain(white, 1, 1, 1, 55)).toEqual(white); // full protection → white untouched
  });

  it("applies stronger grain in midtones than near-highlights (more protection up top)", () => {
    // same seed → same draws; protect ≈0.5 at mid vs ≈0.054 near white, and neither tone
    // clamps, so the total grain magnitude is strictly larger in the midtones.
    const mids = fill(32768); // protect ≈ 0.5
    const brights = fill(62000); // protect ≈ 0.054
    const totalChange = (src: number[], out: number[]) =>
      out.reduce((a, v, i) => a + (i % 4 !== 3 ? Math.abs(v - src[i]) : 0), 0);
    const mOut = filmGrain(mids, 1, 1, 1, 88);
    const bOut = filmGrain(brights, 1, 1, 1, 88);
    expect(totalChange(mids, mOut)).toBeGreaterThan(totalChange(brights, bOut));
  });
});

// ── Several grain/highlight/intensity fixtures swept for invariants ───────────
const FIXTURES: { name: string; grain: number; highlight: number; intensity: number }[] = [
  { name: "subtle", grain: 0.2, highlight: 0, intensity: 0.5 },
  { name: "heavy clean highlights", grain: 1, highlight: 1, intensity: 1 },
  { name: "mid protection", grain: 0.6, highlight: 0.5, intensity: 0.7 },
  { name: "no intensity boost", grain: 0.5, highlight: 0.3, intensity: 0 },
];

describe.each(FIXTURES)("fixture: $name", ({ grain, highlight, intensity }) => {
  it("produces neutral, in-range, deterministic grain with alpha preserved", () => {
    const src = [
      0, 0, 0, 65535, 20000, 20000, 20000, 40000, 45000, 45000, 45000, 65535, NOISE_MAX, NOISE_MAX, NOISE_MAX, 65535,
    ];
    const out = filmGrain(src, grain, highlight, intensity, 13579);
    expect(filmGrain(src, grain, highlight, intensity, 13579)).toEqual(out); // deterministic
    for (let p = 0; p < out.length; p += 4) {
      expect(out[p]).toBe(out[p + 1]); // monochromatic
      expect(out[p + 1]).toBe(out[p + 2]);
      expect(out[p + 3]).toBe(src[p + 3]); // alpha untouched
      for (const v of [out[p], out[p + 1], out[p + 2]]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(NOISE_MAX);
      }
    }
  });
});
