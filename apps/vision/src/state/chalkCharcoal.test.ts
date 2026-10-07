// Unit tests for the Chalk & Charcoal filter. Engine-free (node), single grey-channel model
// (exact for grey R=G=B input with grey fg/bg). These pin the three-tone luminance selection
// (charcoal/chalk/mid against two thresholds), the strict `<`/`>` boundaries, the stroke-pressure
// blend-back, and the truncating output (must match filters.rs chalk_charcoal), plus cross-
// implementation goldens captured from the Rust engine.
import { describe, it, expect } from "vitest";
import {
  chalkCharcoalLum,
  chalkCharcoalTarget,
  chalkCharcoalPixel,
  chalkCharcoal2D,
  CHALK_CHARCOAL_MAX,
  CHALK_CHARCOAL_MID,
} from "./chalkCharcoal";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("chalkCharcoalLum / chalkCharcoalTarget", () => {
  it("luminance maps black→0 and white→~1", () => {
    expect(chalkCharcoalLum(0)).toBe(0);
    expect(chalkCharcoalLum(CHALK_CHARCOAL_MAX)).toBeCloseTo(1, 5);
  });

  it("selects fg below lo, bg above hi, mid in between — with STRICT boundaries", () => {
    expect(chalkCharcoalTarget(0.1, 0.3, 0.7, 0, 65535)).toBe(0); // l<lo → fg
    expect(chalkCharcoalTarget(0.5, 0.3, 0.7, 0, 65535)).toBe(CHALK_CHARCOAL_MID); // between → mid
    expect(chalkCharcoalTarget(0.9, 0.3, 0.7, 0, 65535)).toBe(65535); // l>hi → bg
    expect(chalkCharcoalTarget(0.3, 0.3, 0.7, 0, 65535)).toBe(CHALK_CHARCOAL_MID); // l==lo → NOT fg
    expect(chalkCharcoalTarget(0.7, 0.3, 0.7, 0, 65535)).toBe(CHALK_CHARCOAL_MID); // l==hi → NOT bg
  });
});

describe("chalkCharcoalPixel", () => {
  it("at full pressure posterises to the three tones (default black/white)", () => {
    // charcoal_area 0.3, chalk_area 0.3 ⇒ lo=0.3, hi=0.7. Dark→0, light→65535, mid→32768.
    expect(chalkCharcoalPixel(0, 0.3, 0.3, 1, 0, 255)).toBe(0); // l=0 < 0.3 → fg
    expect(chalkCharcoalPixel(65535, 0.3, 0.3, 1, 0, 255)).toBe(CHALK_CHARCOAL_MAX); // l≈1 > 0.7 → bg
    expect(chalkCharcoalPixel(32768, 0.3, 0.3, 1, 0, 255)).toBe(CHALK_CHARCOAL_MID); // l≈0.5 → mid
  });

  it("treats luminance EXACTLY equal to the low threshold as mid, not charcoal (strict <)", () => {
    // charcoal_area = lum(20000) so l === lo exactly. `l < lo` is false → mid (32768); a `<=`
    // mutant would pick fg (0). Built from the lum helper to avoid a magic 17-digit literal.
    expect(chalkCharcoalPixel(20000, chalkCharcoalLum(20000), 0.3, 1, 0, 255)).toBe(32768);
  });

  it("pins the per-op f32 rounding (fround-sensitive goldens an f64 computation would miss)", () => {
    // charcoal_area 0.45 ⇒ these dark pixels take the fg tone and blend at keep=0.7; the engine's
    // f32 order yields 63 / 119, while a no-fround f64 mirror gives 62 / 118. Captured from the engine.
    expect(chalkCharcoalPixel(90, 0.45, 0.45, 0.3, 0, 255)).toBe(63);
    expect(chalkCharcoalPixel(170, 0.45, 0.45, 0.3, 0, 255)).toBe(119);
  });

  it("stroke pressure 0 (keep=1) is the identity; custom grey fg/bg recolour the tones", () => {
    for (const v of [0, 1000, 32768, 60000, CHALK_CHARCOAL_MAX]) {
      expect(chalkCharcoalPixel(v, 0.3, 0.3, 0, 0, 255)).toBe(v); // pressure 0 → original
    }
    // fg=64 (→16448), bg=200 (→51400): a dark pixel becomes 16448, a light one 51400.
    expect(chalkCharcoalPixel(0, 0.3, 0.3, 1, 64, 200)).toBe(16448);
    expect(chalkCharcoalPixel(65535, 0.3, 0.3, 1, 64, 200)).toBe(51400);
  });
});

describe("chalkCharcoal2D", () => {
  it("at full pressure emits ONLY the three tone colours", () => {
    const g = grid(9, 11, (x, y) => (x * 6151 + y * 3079) % CHALK_CHARCOAL_MAX);
    const out = chalkCharcoal2D(g, 0.3, 0.3, 1, 0, 255);
    for (const v of flat(out)) expect(v === 0 || v === CHALK_CHARCOAL_MID || v === CHALK_CHARCOAL_MAX).toBe(true);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % CHALK_CHARCOAL_MAX);
    for (const [ca, ck, sp] of [
      [0.3, 0.3, 1],
      [0.4, 0.2, 0.5],
      [0.1, 0.6, 0.8],
    ]) {
      for (const v of flat(chalkCharcoal2D(g, ca, ck, sp))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(CHALK_CHARCOAL_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(chalkCharcoal2D([], 0.3, 0.3, 1)).toEqual([]);
    expect(chalkCharcoal2D([[], []], 0.3, 0.3, 1)).toEqual([[], []]);
    expect(chalkCharcoal2D([[40000]], 0.3, 0.3, 1)).toEqual([[CHALK_CHARCOAL_MID]]); // l≈0.61 → mid
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(chalkCharcoal2D(g, 0.4, 0.2, 0.5)).toEqual(chalkCharcoal2D(g, 0.4, 0.2, 0.5));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % CHALK_CHARCOAL_MAX);
    const snapshot = g.map((r) => [...r]);
    chalkCharcoal2D(g, 0.3, 0.3, 1);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = chalkCharcoal2D(g, 0.3, 0.3, 0.5);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's chalk_charcoal
//    on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. Three param sets exercise the pure
//    three-tone poster, the stroke-pressure blend (with truncation), and custom grey fg/bg. Fully
//    bit-exact (no trig/sqrt). ──
describe("engine golden (chalk_charcoal, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % CHALK_CHARCOAL_MAX);
  const asRows = (vals: number[]): number[][] => Array.from({ length: 7 }, (_, y) => vals.slice(y * 7, y * 7 + 7));

  it("matches the engine bit-exactly — charcoal 0.3, chalk 0.3, pressure 1, black/white", () => {
    expect(chalkCharcoal2D(input, 0.3, 0.3, 1, 0, 255)).toEqual(
      asRows([
        0, 0, 32768, 32768, 32768, 65535, 65535, 0, 32768, 32768, 32768, 65535, 65535, 0, 32768, 32768, 32768, 65535,
        65535, 0, 0, 32768, 32768, 65535, 65535, 0, 0, 32768, 32768, 65535, 65535, 0, 0, 32768, 32768, 65535, 65535, 0,
        0, 32768, 32768, 32768, 65535, 0, 0, 32768, 32768, 32768, 65535,
      ]),
    );
  });

  it("matches the engine bit-exactly — charcoal 0.4, chalk 0.2, pressure 0.5 (blend, truncates)", () => {
    expect(chalkCharcoal2D(input, 0.4, 0.2, 0.5, 0, 255)).toEqual(
      asRows([
        0, 4986, 9973, 31343, 36330, 41316, 62686, 4965, 9952, 31322, 36309, 41295, 62665, 2117, 9931, 31301, 36288,
        41274, 62644, 2096, 7082, 31280, 36267, 41253, 62623, 2075, 7061, 12048, 36246, 41232, 62602, 2054, 7040, 12027,
        33397, 41211, 62581, 2033, 7019, 12006, 33376, 38363, 62560, 2012, 6998, 11985, 33355, 38342, 59712,
      ]),
    );
  });

  it("matches the engine bit-exactly — overlapping thresholds (charcoal 0.7 + chalk 0.7 ⇒ lo>hi)", () => {
    // charcoal_area + chalk_area > 1 ⇒ lo=0.7 > hi=0.3, so the mid branch is UNREACHABLE: every
    // pixel is fg (l<0.7) or bg (l≥0.7) — the charcoal (l<lo) test wins the overlap. Only {0,65535}.
    const out = chalkCharcoal2D(input, 0.7, 0.7, 1, 0, 255);
    for (const v of flat(out)) expect(v === 0 || v === CHALK_CHARCOAL_MAX).toBe(true);
    expect(out).toEqual(
      asRows([
        0, 0, 0, 0, 0, 65535, 65535, 0, 0, 0, 0, 65535, 65535, 0, 0, 0, 0, 65535, 65535, 0, 0, 0, 0, 65535, 65535, 0, 0,
        0, 0, 65535, 65535, 0, 0, 0, 0, 65535, 65535, 0, 0, 0, 0, 0, 65535, 0, 0, 0, 0, 0, 65535,
      ]),
    );
  });

  it("matches the engine bit-exactly — custom grey fg=64, bg=200, pressure 1", () => {
    expect(chalkCharcoal2D(input, 0.3, 0.3, 1, 64, 200)).toEqual(
      asRows([
        16448, 16448, 32768, 32768, 32768, 51400, 51400, 16448, 32768, 32768, 32768, 51400, 51400, 16448, 32768, 32768,
        32768, 51400, 51400, 16448, 16448, 32768, 32768, 51400, 51400, 16448, 16448, 32768, 32768, 51400, 51400, 16448,
        16448, 32768, 32768, 51400, 51400, 16448, 16448, 32768, 32768, 32768, 51400, 16448, 16448, 32768, 32768, 32768,
        51400,
      ]),
    );
  });
});

// ── Several param fixtures swept for in-range, shape, and pressure-0 invariance ──
const FIXTURES: { name: string; ca: number; ck: number; sp: number }[] = [
  { name: "wide charcoal", ca: 0.6, ck: 0.1, sp: 1 },
  { name: "wide chalk", ca: 0.1, ck: 0.6, sp: 0.7 },
  { name: "balanced soft", ca: 0.33, ck: 0.33, sp: 0.4 },
];

describe.each(FIXTURES)("fixture: $name", ({ ca, ck, sp }) => {
  it("stays in range, keeps shape, and pressure 0 is the identity", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % CHALK_CHARCOAL_MAX);
    const out = chalkCharcoal2D(g, ca, ck, sp);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(CHALK_CHARCOAL_MAX);
    }
    expect(chalkCharcoal2D(g, ca, ck, 0)).toEqual(g.map((r) => [...r])); // pressure 0 → original
  });
});
