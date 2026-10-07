// Unit tests for the Graphic Pen filter. Engine-free (node), single luminance-channel model
// (exact for grey R=G=B input). These pin the stroke spacing (2+10·strokeLength), the darkness
// = clamp(1−luma+balance−0.5), the per-direction coord, the rem_euclid ramp, and the
// `darkness > ramp` ink decision with the ·257 widening (must match filters.rs graphic_pen),
// plus cross-implementation goldens captured from the Rust engine (both a fg/bg mix).
import { describe, it, expect } from "vitest";
import { graphicPenSpacing, graphicPenPixel, graphicPen2D, GRAPHIC_PEN_MAX } from "./graphicPen";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("graphicPenSpacing", () => {
  it("is 2 + 10·clamp(strokeLength, 0, 1) (2..12 px)", () => {
    expect(graphicPenSpacing(0)).toBe(2);
    expect(graphicPenSpacing(0.5)).toBe(7);
    expect(graphicPenSpacing(1)).toBe(12);
    expect(graphicPenSpacing(0.3)).toBe(5);
    expect(graphicPenSpacing(2)).toBe(12); // clamped
    expect(graphicPenSpacing(-1)).toBe(2); // clamped
  });
});

describe("graphicPenPixel", () => {
  it("inks a black pixel (darkness 1 > any ramp) and leaves a white pixel background", () => {
    const black = [[0]];
    const white = [[GRAPHIC_PEN_MAX]];
    expect(graphicPenPixel(black, 0, 0, 0.5, 0.5, 0, 0, 255)).toBe(0); // darkness 1 → fg
    expect(graphicPenPixel(white, 0, 0, 0.5, 0.5, 0, 0, 255)).toBe(65535); // darkness 0 → bg
  });

  it("a higher balance darkens the metric and inks a white pixel that 0.5 left background", () => {
    const white = [[GRAPHIC_PEN_MAX]];
    // balance 1 → darkness = clamp(0 + 0.5) = 0.5; at coord 0 the ramp is 0 → 0.5 > 0 → fg
    expect(graphicPenPixel(white, 0, 0, 0.5, 1, 0, 0, 255)).toBe(0);
    expect(graphicPenPixel(white, 0, 0, 0.5, 0.5, 0, 0, 255)).toBe(65535); // balance 0.5 → bg
  });

  it("a pixel whose darkness EXACTLY equals the ramp stays background (strict >, not >=)", () => {
    // white (darkness 0) at spacing 2 (strokeLength 0) and an even coord → ramp = 0, so
    // darkness(0) > ramp(0) is false → bg; a `>=` mutant would ink it fg.
    const white = grid(4, 4, () => GRAPHIC_PEN_MAX);
    expect(graphicPenPixel(white, 0, 0, 0, 0.5, 0, 0, 255)).toBe(65535); // 0 > 0 → false → bg
  });

  it("widens the 8-bit fg/bg to 16-bit via ·257", () => {
    expect(graphicPenPixel([[0]], 0, 0, 0.5, 0.5, 0, 50, 200)).toBe(50 * 257); // fg = 12850
    expect(graphicPenPixel([[GRAPHIC_PEN_MAX]], 0, 0, 0.5, 0.5, 0, 50, 200)).toBe(200 * 257); // bg
  });

  it("uses a different ramp per direction (the hatching angle)", () => {
    // a mid-grey ramp image so the ramp position decides ink; different directions disagree
    const g = grid(9, 9, (x, y) => (x * 6151 + y * 3079) % GRAPHIC_PEN_MAX);
    const dir = (d: number) => graphicPen2D(g, 0.5, 0.5, d, 0, 255);
    expect(dir(0)).not.toEqual(dir(1)); // x+y vs y
    expect(dir(1)).not.toEqual(dir(3)); // y vs x
    expect(dir(2)).not.toEqual(dir(0)); // x−y vs x+y (the negative-coord direction)
    expect(dir(2)).not.toEqual(dir(3)); // x−y vs x
  });
});

describe("graphicPen2D", () => {
  it("renders a flat black field entirely foreground and a flat white field entirely background", () => {
    expect(graphicPen2D(grid(8, 8, () => 0), 0.5, 0.5, 0, 0, 255)).toEqual(grid(8, 8, () => 0));
    expect(graphicPen2D(grid(8, 8, () => GRAPHIC_PEN_MAX), 0.5, 0.5, 0, 0, 255)).toEqual(
      grid(8, 8, () => 65535),
    );
  });

  it("emits only the two tones (fg·257 and bg·257)", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % GRAPHIC_PEN_MAX);
    for (const [fg, bg] of [
      [0, 255],
      [50, 200],
    ]) {
      const tones = [fg * 257, bg * 257];
      for (const v of flat(graphicPen2D(g, 0.4, 0.5, 0, fg, bg))) expect(tones).toContain(v);
    }
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % GRAPHIC_PEN_MAX);
    for (const [sl, bal, dir] of [
      [0, 0.5, 0],
      [0.5, 0.7, 1],
      [1, 0.3, 2],
    ]) {
      for (const v of flat(graphicPen2D(g, sl, bal, dir, 0, 255))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(GRAPHIC_PEN_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(graphicPen2D([], 0.5, 0.5, 0, 0, 255)).toEqual([]);
    expect(graphicPen2D([[], []], 0.5, 0.5, 0, 0, 255)).toEqual([[], []]);
    expect(graphicPen2D([[0]], 0.5, 0.5, 0, 0, 255)).toEqual([[0]]); // black lone pixel → fg
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(graphicPen2D(g, 0.3, 0.6, 3, 50, 200)).toEqual(graphicPen2D(g, 0.3, 0.6, 3, 50, 200));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % GRAPHIC_PEN_MAX);
    const snapshot = g.map((r) => [...r]);
    graphicPen2D(g, 0.5, 0.5, 0, 0, 255);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = graphicPen2D(g, 0.5, 0.5, 2, 0, 255);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's graphic_pen
//    on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. Both cases produce a MIX of fg/bg
//    (28 and 37 inked of 49) — the hatching decision is genuinely exercised. Fully bit-exact
//    (no trig/sqrt; all ops innocuous under double rounding). ──
describe("engine golden (graphic_pen, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % GRAPHIC_PEN_MAX);

  it("matches the engine bit-exactly — strokeLength 0.5, balance 0.5, diagonal, black/white", () => {
    expect(graphicPen2D(input, 0.5, 0.5, 0, 0, 255)).toEqual([
      [0, 0, 0, 0, 65535, 65535, 65535],
      [0, 0, 0, 65535, 65535, 65535, 0],
      [0, 0, 65535, 65535, 65535, 0, 0],
      [0, 65535, 65535, 65535, 0, 0, 0],
      [65535, 65535, 65535, 0, 0, 0, 0],
      [65535, 65535, 0, 0, 0, 0, 65535],
      [65535, 0, 0, 0, 0, 65535, 65535],
    ]);
  });

  it("matches the engine bit-exactly — strokeLength 0.3, balance 0.6, vertical, grey fg/bg (·257)", () => {
    expect(graphicPen2D(input, 0.3, 0.6, 3, 50, 200)).toEqual([
      [12850, 12850, 12850, 12850, 51400, 12850, 51400],
      [12850, 12850, 12850, 51400, 51400, 12850, 12850],
      [12850, 12850, 12850, 51400, 51400, 12850, 12850],
      [12850, 12850, 51400, 51400, 12850, 12850, 12850],
      [12850, 12850, 51400, 12850, 12850, 12850, 12850],
      [12850, 51400, 12850, 12850, 51400, 12850, 12850],
      [12850, 12850, 12850, 12850, 51400, 12850, 12850],
    ]);
  });

  it("matches the engine bit-exactly — direction 2 (x−y, exercises the rem_euclid negative lift)", () => {
    // dir 2 is the only direction whose coord (x−y) goes negative, so this is the only golden
    // that pins the rem_euclid lift `if (r<0) r+=spacing` and the sign of (x−y). 28/49 inked.
    expect(graphicPen2D(input, 0.5, 0.5, 2, 0, 255)).toEqual([
      [0, 0, 0, 0, 65535, 65535, 65535],
      [65535, 0, 0, 0, 65535, 65535, 0],
      [65535, 65535, 0, 0, 65535, 0, 0],
      [65535, 65535, 65535, 0, 0, 0, 0],
      [65535, 65535, 65535, 0, 0, 0, 0],
      [65535, 65535, 0, 0, 65535, 0, 0],
      [65535, 0, 0, 0, 65535, 65535, 0],
    ]);
  });
});

// ── Several stroke/balance/direction fixtures swept for two-tone, shape, black→fg / white→bg ──
const FIXTURES: { name: string; sl: number; bal: number; dir: number; fg: number; bg: number }[] = [
  { name: "fine diagonal", sl: 0.2, bal: 0.5, dir: 0, fg: 0, bg: 255 },
  { name: "wide vertical", sl: 0.9, bal: 0.4, dir: 3, fg: 30, bg: 220 },
  { name: "anti-diagonal", sl: 0.5, bal: 0.6, dir: 2, fg: 10, bg: 245 },
];

describe.each(FIXTURES)("fixture: $name", ({ sl, bal, dir, fg, bg }) => {
  it("stays in range, keeps shape, and emits only the two tones", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % GRAPHIC_PEN_MAX);
    const out = graphicPen2D(g, sl, bal, dir, fg, bg);
    const tones = [fg * 257, bg * 257];
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(tones).toContain(v);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(GRAPHIC_PEN_MAX);
    }
  });
});
