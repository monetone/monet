// Unit tests for the Selective Color helpers. Engine-free (node); the dialog +
// engine wiring are covered by the e2e suite + the Rust side. These pin the pure
// math: band classification (must match band_membership), the CMYK accumulation,
// the relative/absolute distinction, and the Black-slider darken/lighten.
import { describe, it, expect } from "vitest";
import {
  defaultSelectiveColor,
  setBandCmyk,
  packSelectiveColor,
  packSelectiveColorLayer,
  bandMembership,
  applySelectiveColor,
  SELECTIVE_BANDS,
  CMYK_LABELS,
  CMYK_MIN,
  CMYK_MAX,
  type SelectiveColorState,
} from "./selectiveColor";

// Band indices.
const REDS = 0, YELLOWS = 1, GREENS = 2, CYANS = 3, BLUES = 4, MAGENTAS = 5, WHITES = 6, NEUTRALS = 7, BLACKS = 8;
// CMYK channel indices.
const C = 0, M = 1, Y = 2, K = 3;

// Build a state with a single band/channel set (others zero).
const one = (band: number, channel: number, value: number, relative = true): SelectiveColorState =>
  setBandCmyk({ ...defaultSelectiveColor(), relative }, band, channel, value);

describe("defaults, constants & packing", () => {
  it("nine bands + CMYK labels in order", () => {
    expect(SELECTIVE_BANDS).toEqual(["Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas", "Whites", "Neutrals", "Blacks"]);
    expect(CMYK_LABELS).toEqual(["Cyan", "Magenta", "Yellow", "Black"]);
    expect([CMYK_MIN, CMYK_MAX]).toEqual([-100, 100]);
  });

  it("default is all-zero, Relative mode", () => {
    const s = defaultSelectiveColor();
    expect(s.relative).toBe(true);
    expect(s.bands.length).toBe(9);
    expect(s.bands.every((row) => row.length === 4 && row.every((x) => x === 0))).toBe(true);
  });

  it("packSelectiveColor is 36 fractions; layer prepends the relative flag (37)", () => {
    const s = setBandCmyk(setBandCmyk(defaultSelectiveColor(), REDS, C, 50), BLACKS, K, -100);
    const corr = packSelectiveColor(s);
    expect(corr.length).toBe(36);
    expect(corr[REDS * 4 + C]).toBeCloseTo(0.5, 6);
    expect(corr[BLACKS * 4 + K]).toBeCloseTo(-1, 6);

    const layer = packSelectiveColorLayer(s);
    expect(layer.length).toBe(37);
    expect(layer[0]).toBe(1); // relative
    expect(layer[1 + REDS * 4 + C]).toBeCloseTo(0.5, 6);
    expect(packSelectiveColorLayer({ ...s, relative: false })[0]).toBe(0);
  });
});

describe("setBandCmyk — immutability & clamping", () => {
  it("sets one channel without mutating the input", () => {
    const s = defaultSelectiveColor();
    const next = setBandCmyk(s, GREENS, Y, 40);
    expect(next.bands[GREENS][Y]).toBe(40);
    expect(s.bands[GREENS][Y]).toBe(0);
    expect(next).not.toBe(s);
  });

  it("clamps to ±100", () => {
    expect(setBandCmyk(defaultSelectiveColor(), REDS, C, 999).bands[REDS][C]).toBe(CMYK_MAX);
    expect(setBandCmyk(defaultSelectiveColor(), REDS, C, -999).bands[REDS][C]).toBe(CMYK_MIN);
  });
});

describe("bandMembership (mirrors the engine classifier)", () => {
  const memberships = (r: number, g: number, b: number) =>
    Array.from({ length: 9 }, (_, band) => bandMembership(band, r, g, b));

  it("pure primaries belong fully to their chromatic band only", () => {
    expect(memberships(1, 0, 0)[REDS]).toBeCloseTo(1, 6);
    expect(memberships(0, 1, 0)[GREENS]).toBeCloseTo(1, 6);
    expect(memberships(0, 0, 1)[BLUES]).toBeCloseTo(1, 6);
    // red is in no other band
    expect(memberships(1, 0, 0).filter((_, i) => i !== REDS).every((w) => w === 0)).toBe(true);
  });

  it("secondary hues map to their bands", () => {
    expect(memberships(1, 1, 0)[YELLOWS]).toBeCloseTo(1, 6);
    expect(memberships(0, 1, 1)[CYANS]).toBeCloseTo(1, 6);
    expect(memberships(1, 0, 1)[MAGENTAS]).toBeCloseTo(1, 6);
  });

  it("white → Whites, black → Blacks, mid-gray → Neutrals (each fully, others 0)", () => {
    expect(memberships(1, 1, 1)[WHITES]).toBeCloseTo(1, 6);
    expect(memberships(0, 0, 0)[BLACKS]).toBeCloseTo(1, 6);
    const gray = memberships(0.5, 0.5, 0.5);
    expect(gray[NEUTRALS]).toBeCloseTo(1, 6);
    expect(gray.filter((_, i) => i !== NEUTRALS).every((w) => w === 0)).toBe(true);
  });

  it("a between-hue colour splits across two adjacent chromatic bands", () => {
    // hue 30° (orange) sits halfway between Reds (0°) and Yellows (60°).
    const m = memberships(1, 0.5, 0);
    expect(m[REDS]).toBeGreaterThan(0);
    expect(m[YELLOWS]).toBeGreaterThan(0);
    expect(m[GREENS]).toBe(0);
  });
});

describe("applySelectiveColor — identity & exact pins", () => {
  it("identity is a no-op for any pixel", () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [64, 128, 192],
      [200, 100, 50],
      [128, 128, 128],
    ]) {
      expect(applySelectiveColor(defaultSelectiveColor(), r, g, b)).toEqual({ r, g, b });
    }
  });

  it("Reds Black +50 darkens red → (128,0,0); −50 lightens → (255,128,128)", () => {
    expect(applySelectiveColor(one(REDS, K, 50), 255, 0, 0)).toEqual({ r: 128, g: 0, b: 0 });
    expect(applySelectiveColor(one(REDS, K, -50), 255, 0, 0)).toEqual({ r: 255, g: 128, b: 128 });
  });

  it("Relative vs Absolute differ where there is no existing ink", () => {
    // Red has no cyan ink (c0=0): Absolute Cyan+100 fully inks → black; Relative
    // scales by c0=0 → no change.
    expect(applySelectiveColor(one(REDS, C, 100, false), 255, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(applySelectiveColor(one(REDS, C, 100, true), 255, 0, 0)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("Whites Black +50 darkens white to gray; Blacks band leaves white alone", () => {
    expect(applySelectiveColor(one(WHITES, K, 50), 255, 255, 255)).toEqual({ r: 128, g: 128, b: 128 });
    expect(applySelectiveColor(one(BLACKS, K, 50), 255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("Neutrals Cyan +50 (absolute) tints mid-gray cyan", () => {
    // 128/255≈0.502, so Neutrals membership≈0.996 (Whites≈0.004); c0≈0.498 + 0.498
    // cyan → c≈0.996 → r≈1; g,b unchanged → (1,128,128).
    expect(applySelectiveColor(one(NEUTRALS, C, 50, false), 128, 128, 128)).toEqual({ r: 1, g: 128, b: 128 });
  });

  it("a band only affects its own pixels (Greens edit leaves a red pixel alone)", () => {
    const s = setBandCmyk(setBandCmyk(defaultSelectiveColor(), GREENS, C, 80), GREENS, K, 60);
    expect(applySelectiveColor(s, 255, 0, 0)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("is deterministic", () => {
    const s = setBandCmyk(defaultSelectiveColor(), REDS, M, 40);
    expect(applySelectiveColor(s, 200, 60, 40)).toEqual(applySelectiveColor(s, 200, 60, 40));
  });
});

// ── Several fixtures swept for in-gamut + determinism ───────────────────────
function build(edits: [number, number, number][], relative = true): SelectiveColorState {
  return edits.reduce((s, [band, ch, v]) => setBandCmyk(s, band, ch, v), { ...defaultSelectiveColor(), relative });
}
const FIXTURES: { name: string; state: SelectiveColorState }[] = [
  { name: "warm reds", state: build([[REDS, M, 20], [REDS, Y, 30]]) },
  { name: "deepen blacks", state: build([[BLACKS, K, 60]]) },
  { name: "cool the whites", state: build([[WHITES, C, 25], [WHITES, K, -10]]) },
  { name: "absolute swing", state: build([[GREENS, C, -100], [GREENS, Y, 100], [NEUTRALS, K, 40]], false) },
  { name: "every band nudged", state: build(SELECTIVE_BANDS.map((_, b): [number, number, number] => [b, K, b % 2 ? 30 : -30])) },
];

describe.each(FIXTURES)("fixture: $name", ({ state }) => {
  it("produces finite, in-gamut, deterministic output across a pixel set", () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [64, 128, 192],
      [255, 255, 255],
      [220, 30, 70],
      [128, 128, 128],
      [40, 200, 90],
    ];
    for (const [r, g, b] of pixels) {
      const out = applySelectiveColor(state, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applySelectiveColor(state, r, g, b)).toEqual(out);
    }
  });
});
