// Unit tests for the Auto Tone / Auto Contrast helpers. Engine-free (node). These
// pin the histogram clip-bound search and the integer-division stretch (must match
// mod.rs hist_bounds / auto_stretch), plus the per-channel vs combined behaviour.
import { describe, it, expect } from "vitest";
import {
  histBounds,
  autoStretchValue,
  autoToneRanges,
  autoContrastRange,
  autoStretch,
  autoColor,
  CLIP_FRAC,
  type Rgb,
} from "./autoLevels";

const meanOf = (px: Rgb[], k: keyof Rgb) => px.reduce((a, p) => a + p[k], 0) / px.length;
const channelMeanSpread = (px: Rgb[]) => {
  const m = [meanOf(px, "r"), meanOf(px, "g"), meanOf(px, "b")];
  return Math.max(...m) - Math.min(...m);
};

const zeros = () => new Array<number>(256).fill(0);
const spike = (bins: Record<number, number>) => {
  const h = zeros();
  for (const [b, n] of Object.entries(bins)) h[Number(b)] = n;
  return h;
};

describe("histBounds (mirrors mod.rs hist_bounds)", () => {
  it("defaults to the 0.1% clip and full range on an empty histogram", () => {
    expect(CLIP_FRAC).toBe(0.001);
    expect(histBounds(zeros())).toEqual({ lo: 0, hi: 255 });
  });

  it("finds the occupied range when nothing is clipped", () => {
    expect(histBounds(spike({ 50: 1000, 200: 1000 }))).toEqual({ lo: 50, hi: 200 });
    expect(histBounds(spike({ 128: 1000 }))).toEqual({ lo: 128, hi: 128 }); // single bin → flat
    expect(histBounds(spike({ 0: 1000, 255: 1000 }))).toEqual({ lo: 0, hi: 255 });
  });

  it("clips a small fraction of outliers at each end", () => {
    // total 99950, clip = floor(99.95) = 99; the 50-pixel outliers at 0 and 255 are
    // dropped, so the range tightens to the bulk at 20..230.
    expect(histBounds(spike({ 0: 50, 20: 49900, 230: 49950, 255: 50 }))).toEqual({ lo: 20, hi: 230 });
  });

  it("a bigger-than-clip spike at the end is kept", () => {
    // clip = floor(2000·0.001) = 2; the end spikes (1000 each) exceed it → kept.
    expect(histBounds(spike({ 0: 1000, 255: 1000 }), 0.001)).toEqual({ lo: 0, hi: 255 });
  });

  it("honours a custom clip fraction", () => {
    // total 100, clip = floor(10) = 10; bins 0..(cum≤10) clipped from each end.
    expect(histBounds(spike({ 0: 10, 60: 80, 255: 10 }), 0.1)).toEqual({ lo: 60, hi: 60 });
  });
});

describe("autoStretchValue (integer-division stretch)", () => {
  it("maps the range endpoints to 0 and 255", () => {
    expect(autoStretchValue(50, 50, 200)).toBe(0);
    expect(autoStretchValue(200, 50, 200)).toBe(255);
  });

  it("uses truncating integer division", () => {
    expect(autoStretchValue(125, 50, 200)).toBe(127); // trunc(75·255/150) = trunc(127.5)
  });

  it("clamps values outside the range", () => {
    expect(autoStretchValue(40, 50, 200)).toBe(0); // below lo → negative → 0
    expect(autoStretchValue(255, 50, 200)).toBe(255); // above hi → >255 → 255
  });

  it("a full range is the identity", () => {
    for (const v of [0, 1, 64, 128, 200, 255]) expect(autoStretchValue(v, 0, 255)).toBe(v);
  });

  it("leaves the value unchanged when hi ≤ lo (flat channel)", () => {
    expect(autoStretchValue(137, 128, 128)).toBe(137);
    expect(autoStretchValue(40, 200, 100)).toBe(40);
  });
});

// A low-contrast image: each channel occupies a different sub-range.
const lowContrast: Rgb[] = [
  { r: 50, g: 60, b: 40 },
  { r: 90, g: 100, b: 110 },
  { r: 130, g: 140, b: 150 },
  { r: 170, g: 165, b: 175 },
  { r: 200, g: 190, b: 210 },
];

describe("autoToneRanges / autoContrastRange", () => {
  it("Auto Tone derives a per-channel range; Auto Contrast one combined range", () => {
    const [rR, rG, rB] = autoToneRanges(lowContrast);
    expect(rR).toEqual({ lo: 50, hi: 200 }); // R spans 50..200
    expect(rG).toEqual({ lo: 60, hi: 190 });
    expect(rB).toEqual({ lo: 40, hi: 210 });
    // combined histogram spans the union of all channels: 40..210
    expect(autoContrastRange(lowContrast)).toEqual({ lo: 40, hi: 210 });
  });

  it("the combined histogram has 3× the samples, so Auto Contrast can clip where Auto Tone does not", () => {
    // 400 mid-gray pixels (1200 combined samples) + one dark + one bright outlier.
    const px: Rgb[] = [
      ...Array.from({ length: 400 }, () => ({ r: 128, g: 128, b: 128 })),
      { r: 1, g: 2, b: 3 },
      { r: 252, g: 253, b: 254 },
    ];
    // Combined total 1206 → clip floor(1.206)=1, so the single-sample outlier bins
    // (1 and 254) are dropped, tightening the range to 2..253.
    expect(autoContrastRange(px)).toEqual({ lo: 2, hi: 253 });
    // Per-channel R total 402 → clip 0 → nothing clipped → wider range.
    expect(autoToneRanges(px)[0]).toEqual({ lo: 1, hi: 252 });
  });

  it("honours a custom clipFrac through the higher-level functions", () => {
    const px: Rgb[] = [
      ...Array.from({ length: 400 }, () => ({ r: 128, g: 128, b: 128 })),
      { r: 1, g: 2, b: 3 },
      { r: 252, g: 253, b: 254 },
    ];
    // A large clip fraction collapses the range toward the dominant bin.
    expect(autoContrastRange(px, 0.5).lo).toBe(128);
  });
});

describe("autoStretch — end to end", () => {
  it("Auto Tone stretches each channel to the full [0,255] range", () => {
    const out = autoStretch(lowContrast, true);
    const ch = (k: keyof Rgb) => out.map((p) => p[k]);
    // each channel's min maps to 0 and max to 255
    expect(Math.min(...ch("r"))).toBe(0);
    expect(Math.max(...ch("r"))).toBe(255);
    expect(Math.min(...ch("g"))).toBe(0);
    expect(Math.max(...ch("g"))).toBe(255);
    expect(Math.min(...ch("b"))).toBe(0);
    expect(Math.max(...ch("b"))).toBe(255);
  });

  it("Auto Contrast applies one range to all channels (preserves colour balance)", () => {
    const out = autoStretch(lowContrast, false);
    // The same (lo=40,hi=210) is applied to every channel, so a pixel that was
    // neutral-ish stays balanced; channel order within a pixel is preserved.
    for (let i = 0; i < lowContrast.length; i++) {
      const before = lowContrast[i];
      const after = out[i];
      expect(Math.sign(after.r - after.g)).toBe(Math.sign(before.r - before.g) || 0);
      expect(autoStretchValue(before.r, 40, 210)).toBe(after.r);
    }
  });

  it("a flat image is returned unchanged (engine aborts)", () => {
    const flat: Rgb[] = [
      { r: 128, g: 128, b: 128 },
      { r: 128, g: 128, b: 128 },
    ];
    expect(autoStretch(flat, true)).toEqual(flat);
    expect(autoStretch(flat, false)).toEqual(flat);
  });

  it("an already full-range image is ~unchanged at the endpoints", () => {
    const full: Rgb[] = [
      { r: 0, g: 0, b: 0 },
      { r: 128, g: 128, b: 128 },
      { r: 255, g: 255, b: 255 },
    ];
    const tone = autoStretch(full, true);
    expect(tone[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(tone[2]).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("is deterministic", () => {
    expect(autoStretch(lowContrast, true)).toEqual(autoStretch(lowContrast, true));
  });
});

// A warm colour cast: red elevated, blue suppressed.
const warmCast: Rgb[] = [
  { r: 120, g: 60, b: 30 },
  { r: 160, g: 90, b: 50 },
  { r: 200, g: 120, b: 70 },
  { r: 90, g: 40, b: 20 },
];

describe("autoColor (Auto Color: stretch + midtone neutralization)", () => {
  it("neutralizes a colour cast (channel-mean spread collapses)", () => {
    const before = channelMeanSpread(warmCast); // ~100
    const after = channelMeanSpread(autoColor(warmCast));
    expect(after).toBeLessThan(before / 5); // cast strongly reduced
  });

  it("pins the exact output for the warm-cast fixture", () => {
    expect(autoColor(warmCast)).toEqual([
      { r: 66, g: 62, b: 54 },
      { r: 160, g: 158, b: 156 },
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
    ]);
  });

  it("preserves each channel's full range (gamma fixes the 0/255 endpoints)", () => {
    const out = autoColor(warmCast);
    for (const k of ["r", "g", "b"] as (keyof Rgb)[]) {
      expect(Math.min(...out.map((p) => p[k]))).toBe(0);
      expect(Math.max(...out.map((p) => p[k]))).toBe(255);
    }
  });

  it("on a grayscale image reduces to Auto Tone (means already balanced → gamma 1)", () => {
    const gray: Rgb[] = [
      { r: 50, g: 50, b: 50 },
      { r: 120, g: 120, b: 120 },
      { r: 200, g: 200, b: 200 },
    ];
    expect(autoColor(gray)).toEqual(autoStretch(gray, true));
  });

  it("returns a flat image unchanged (engine aborts)", () => {
    const flat: Rgb[] = [{ r: 90, g: 90, b: 90 }, { r: 90, g: 90, b: 90 }];
    expect(autoColor(flat)).toEqual(flat);
  });

  it("a flat channel skips the stretch but still receives the midtone gamma", () => {
    // R is constant (100) → its range is flat → no stretch; but the gamma still
    // shifts it (100 → 117), exactly as the engine's gamma loop has no flat guard.
    expect(autoColor([{ r: 100, g: 0, b: 0 }, { r: 100, g: 128, b: 200 }, { r: 100, g: 255, b: 90 }])).toEqual([
      { r: 117, g: 0, b: 0 },
      { r: 117, g: 117, b: 255 },
      { r: 117, g: 255, b: 108 },
    ]);
  });

  it("neutralizes a cool cast symmetrically to the warm one", () => {
    const coolCast: Rgb[] = [
      { r: 30, g: 60, b: 120 },
      { r: 50, g: 90, b: 160 },
      { r: 70, g: 120, b: 200 },
      { r: 20, g: 40, b: 90 },
    ];
    expect(autoColor(coolCast)).toEqual([
      { r: 54, g: 62, b: 66 },
      { r: 156, g: 158, b: 160 },
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
    ]);
    expect(channelMeanSpread(autoColor(coolCast))).toBeLessThan(channelMeanSpread(coolCast) / 5);
  });

  it("is deterministic", () => {
    expect(autoColor(warmCast)).toEqual(autoColor(warmCast));
  });
});

// ── Several image fixtures swept for valid, in-gamut output ──────────────────
const FIXTURES: { name: string; pixels: Rgb[] }[] = [
  { name: "dark photo", pixels: [{ r: 10, g: 20, b: 5 }, { r: 30, g: 45, b: 25 }, { r: 60, g: 80, b: 50 }, { r: 90, g: 110, b: 70 }] },
  { name: "washed out", pixels: [{ r: 180, g: 175, b: 185 }, { r: 200, g: 205, b: 195 }, { r: 220, g: 215, b: 225 }, { r: 240, g: 235, b: 245 }] },
  { name: "colour cast", pixels: [{ r: 120, g: 60, b: 30 }, { r: 160, g: 90, b: 50 }, { r: 200, g: 120, b: 70 }, { r: 90, g: 40, b: 20 }] },
];

describe.each(FIXTURES)("fixture: $name", ({ pixels }) => {
  it("Auto Tone / Auto Contrast / Auto Color yield valid 8-bit pixels", () => {
    const outs = [autoStretch(pixels, true), autoStretch(pixels, false), autoColor(pixels)];
    for (const out of outs) {
      expect(out.length).toBe(pixels.length);
      for (const p of out) {
        for (const c of [p.r, p.g, p.b]) {
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});
