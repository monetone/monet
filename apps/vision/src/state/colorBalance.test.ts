// Unit tests for the Color Balance helpers. Engine-free (node); the dialog + engine
// wiring are covered by the e2e suite + the Rust side. These pin the pure math: the
// tonal weighting (must match the engine), the 0.25 shift scale, packing, preserve
// luminosity, and the per-range/per-axis behaviour.
import { describe, it, expect } from "vitest";
import {
  defaultColorBalance,
  setBalance,
  toneWeights,
  packColorBalanceTriads,
  packColorBalanceLayer,
  applyColorBalance,
  zeroTriad,
  TONE_RANGES,
  COLOR_BALANCE_AXES,
  BALANCE_MIN,
  BALANCE_MAX,
  LUMA_R,
  LUMA_G,
  LUMA_B,
  type ColorBalanceState,
} from "./colorBalance";

const lum = (r: number, g: number, b: number) => LUMA_R * r + LUMA_G * g + LUMA_B * b;
const close = (got: Float32Array, want: number[]) => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 6));

describe("defaults & identity", () => {
  it("defaultColorBalance is all-zero with preserve on", () => {
    const s = defaultColorBalance();
    expect(s.shadows).toEqual(zeroTriad());
    expect(s.midtones).toEqual(zeroTriad());
    expect(s.highlights).toEqual(zeroTriad());
    expect(s.preserveLuminosity).toBe(true);
  });

  it("is a pixel no-op for any pixel and either preserve setting", () => {
    for (const preserve of [true, false]) {
      const s = { ...defaultColorBalance(), preserveLuminosity: preserve };
      for (const [r, g, b] of [
        [0, 0, 0],
        [255, 255, 255],
        [128, 128, 128],
        [26, 130, 220],
      ]) {
        expect(applyColorBalance(s, r, g, b)).toEqual({ r, g, b });
      }
    }
  });

  it("TONE_RANGES and COLOR_BALANCE_AXES are in engine order", () => {
    expect(TONE_RANGES.map((t) => t.key)).toEqual(["shadows", "midtones", "highlights"]);
    expect(COLOR_BALANCE_AXES.map((a) => a.key)).toEqual(["cyanRed", "magentaGreen", "yellowBlue"]);
  });
});

describe("toneWeights (matches the engine)", () => {
  it("shadows peak at black, highlights at white, midtones at mid-gray", () => {
    expect(toneWeights(0)).toEqual({ shadow: 1, midtone: 0, highlight: 0 });
    expect(toneWeights(1)).toEqual({ shadow: 0, midtone: 0, highlight: 1 });
    const mid = toneWeights(0.5);
    expect(mid.midtone).toBeCloseTo(1, 6);
    expect(mid.shadow).toBeCloseTo(0.25, 6);
    expect(mid.highlight).toBeCloseTo(0.25, 6);
  });

  it("uses (1-l)^2 / l^2 / max(1-|2l-1|,0)", () => {
    const w = toneWeights(0.25);
    expect(w.shadow).toBeCloseTo(0.5625, 6); // 0.75^2
    expect(w.highlight).toBeCloseTo(0.0625, 6); // 0.25^2
    expect(w.midtone).toBeCloseTo(0.5, 6); // 1 - |−0.5|
  });

  it("clamps l outside [0,1]", () => {
    expect(toneWeights(-1)).toEqual({ shadow: 1, midtone: 0, highlight: 0 });
    expect(toneWeights(2)).toEqual({ shadow: 0, midtone: 0, highlight: 1 });
  });
});

describe("packing", () => {
  it("packColorBalanceLayer → [sh×3, mid×3, hi×3, preserve] as fractions (kind-10)", () => {
    let s = defaultColorBalance();
    s = setBalance(s, "shadows", "cyanRed", 50);
    s = setBalance(s, "midtones", "yellowBlue", -100);
    s = setBalance(s, "highlights", "magentaGreen", 25);
    // The 10th slot is Preserve Luminosity — the kind-10 layer honours it now,
    // so the packer has to carry it or the layer silently loses the setting.
    close(packColorBalanceLayer({ ...s, preserveLuminosity: true }), [0.5, 0, 0, 0, 0, -1, 0, 0.25, 0, 1]);
    close(packColorBalanceLayer({ ...s, preserveLuminosity: false }), [0.5, 0, 0, 0, 0, -1, 0, 0.25, 0, 0]);
  });

  it("packColorBalanceTriads returns three Float32Array(3) each divided by 100", () => {
    let s = setBalance(defaultColorBalance(), "shadows", "cyanRed", 80);
    s = setBalance(s, "midtones", "magentaGreen", -40);
    s = setBalance(s, "highlights", "yellowBlue", 100);
    const p = packColorBalanceTriads(s);
    expect([p.sh.length, p.mid.length, p.hi.length]).toEqual([3, 3, 3]);
    close(p.sh, [0.8, 0, 0]);
    close(p.mid, [0, -0.4, 0]);
    close(p.hi, [0, 0, 1]);
  });
});

describe("setBalance — immutability & clamping", () => {
  it("updates one axis without mutating the input", () => {
    const s = defaultColorBalance();
    const next = setBalance(s, "shadows", "cyanRed", 40);
    expect(next.shadows.cyanRed).toBe(40);
    expect(s.shadows.cyanRed).toBe(0);
    expect(next).not.toBe(s);
  });

  it("clamps to ±100", () => {
    expect(setBalance(defaultColorBalance(), "midtones", "cyanRed", 999).midtones.cyanRed).toBe(BALANCE_MAX);
    expect(setBalance(defaultColorBalance(), "midtones", "cyanRed", -999).midtones.cyanRed).toBe(BALANCE_MIN);
  });
});

describe("shift math (mirrors the engine)", () => {
  it("shadows Red+100 reddens a dark pixel: (26,26,26) → (77,26,26)", () => {
    const s = setBalance({ ...defaultColorBalance(), preserveLuminosity: false }, "shadows", "cyanRed", 100);
    expect(applyColorBalance(s, 26, 26, 26)).toEqual({ r: 77, g: 26, b: 26 });
  });

  it("shadows shift barely touches a bright pixel: (230,230,230) → (231,230,230)", () => {
    const s = setBalance({ ...defaultColorBalance(), preserveLuminosity: false }, "shadows", "cyanRed", 100);
    expect(applyColorBalance(s, 230, 230, 230)).toEqual({ r: 231, g: 230, b: 230 });
  });

  it("highlights Blue+100 brightens blue in a bright pixel, not a dark one", () => {
    const s = setBalance({ ...defaultColorBalance(), preserveLuminosity: false }, "highlights", "yellowBlue", 100);
    const bright = applyColorBalance(s, 230, 230, 230);
    const dark = applyColorBalance(s, 26, 26, 26);
    // Highlights weight (l²) is ≈0.81 for the bright pixel but ≈0.01 for the dark
    // one, so the bright pixel gains far more blue.
    expect(bright.b - 230).toBeGreaterThan(dark.b - 26);
    expect(bright.b - 230).toBeGreaterThanOrEqual(20);
  });

  it("midtones Green+100 affects mid-gray most", () => {
    const s = setBalance({ ...defaultColorBalance(), preserveLuminosity: false }, "midtones", "magentaGreen", 100);
    const midGain = applyColorBalance(s, 128, 128, 128).g - 128;
    const shadowGain = applyColorBalance(s, 26, 26, 26).g - 26;
    const highGain = applyColorBalance(s, 230, 230, 230).g - 230;
    expect(midGain).toBeGreaterThan(shadowGain);
    expect(midGain).toBeGreaterThan(highGain);
  });

  it("negative shifts move toward Cyan/Magenta/Yellow", () => {
    const s = setBalance({ ...defaultColorBalance(), preserveLuminosity: false }, "midtones", "cyanRed", -100);
    expect(applyColorBalance(s, 128, 128, 128).r).toBeLessThan(128); // toward cyan = less red
  });

  it("is deterministic", () => {
    const s = setBalance(defaultColorBalance(), "midtones", "yellowBlue", 60);
    expect(applyColorBalance(s, 70, 130, 180)).toEqual(applyColorBalance(s, 70, 130, 180));
  });
});

describe("preserve luminosity", () => {
  it("keeps output luminance ≈ input (within rounding) for non-clamping mids", () => {
    let s = setBalance(defaultColorBalance(), "midtones", "cyanRed", 60);
    s = setBalance(s, "midtones", "yellowBlue", -40);
    for (const [r, g, b] of [
      [120, 130, 140],
      [90, 110, 100],
      [150, 120, 90],
    ]) {
      const out = applyColorBalance(s, r, g, b);
      expect(Math.abs(lum(out.r, out.g, out.b) - lum(r, g, b))).toBeLessThanOrEqual(2);
    }
  });

  it("stays in-gamut even when the luminance restore would clamp (strong shift near white)", () => {
    // A strong blue highlight shift on a near-white pixel pushes nb past 1; the
    // preserve restore can't fully recover luminance once a channel clamps, but the
    // output must remain valid 8-bit and brighter in blue.
    const s = setBalance(defaultColorBalance(), "highlights", "yellowBlue", 100);
    const out = applyColorBalance(s, 250, 250, 250);
    for (const c of [out.r, out.g, out.b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
    expect(out.b).toBeGreaterThanOrEqual(out.r);
  });

  it("matters: turning it off shifts luminance more than leaving it on", () => {
    const base = setBalance(defaultColorBalance(), "midtones", "yellowBlue", 80);
    const px: [number, number, number] = [120, 130, 140];
    const on = applyColorBalance({ ...base, preserveLuminosity: true }, ...px);
    const off = applyColorBalance({ ...base, preserveLuminosity: false }, ...px);
    const L = lum(...px);
    expect(Math.abs(lum(on.r, on.g, on.b) - L)).toBeLessThan(Math.abs(lum(off.r, off.g, off.b) - L));
  });
});

// ── Several fixtures swept for in-gamut + determinism ───────────────────────
const FIXTURES: { name: string; build: () => ColorBalanceState }[] = [
  { name: "warm shadows / cool highlights", build: () => {
    let s = setBalance(defaultColorBalance(), "shadows", "cyanRed", 30);
    s = setBalance(s, "shadows", "yellowBlue", -20);
    s = setBalance(s, "highlights", "yellowBlue", 25);
    return s;
  } },
  { name: "heavy midtone green", build: () => setBalance(defaultColorBalance(), "midtones", "magentaGreen", 100) },
  { name: "extreme all-axes", build: () => {
    let s = defaultColorBalance();
    for (const t of TONE_RANGES) for (const a of COLOR_BALANCE_AXES) s = setBalance(s, t.key, a.key, t.key === "shadows" ? 100 : -100);
    return s;
  } },
  { name: "no-preserve teal cast", build: () => {
    let s = { ...defaultColorBalance(), preserveLuminosity: false };
    s = setBalance(s, "midtones", "cyanRed", -50);
    s = setBalance(s, "midtones", "yellowBlue", 50);
    return s;
  } },
];

describe.each(FIXTURES)("fixture: $name", ({ build }) => {
  it("stays in-gamut and deterministic across a pixel set", () => {
    const s = build();
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [64, 128, 192],
      [255, 255, 255],
      [200, 40, 90],
      [26, 26, 26],
    ];
    for (const [r, g, b] of pixels) {
      const out = applyColorBalance(s, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applyColorBalance(s, r, g, b)).toEqual(out);
    }
  });
});
