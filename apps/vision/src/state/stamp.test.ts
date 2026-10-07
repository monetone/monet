// Unit tests for the Stamp filter. Engine-free (node), single luminance-channel model (exact
// for grey R=G=B input). These pin the smoothing radius (round(clamp(smoothness,0,1)·8)), the
// luminance smoothing, the threshold against `balance`, and the dark→fg / light→bg mapping
// with the ·257 widening (must match filters.rs stamp), plus a cross-implementation golden
// captured from the Rust engine. Output is always one of the two tones.
import { describe, it, expect } from "vitest";
import { stampRadius, stampPixel, stamp2D, STAMP_MAX } from "./stamp";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("stampRadius", () => {
  it("derives round(clamp(smoothness,0,1)·8), i.e. 0..8 px", () => {
    expect(stampRadius(0)).toBe(0);
    expect(stampRadius(0.5)).toBe(4); // 4.0
    expect(stampRadius(1)).toBe(8);
    expect(stampRadius(0.0625)).toBe(1); // 0.5 → round half up → 1
    expect(stampRadius(0.1875)).toBe(2); // 1.5 → 2
    expect(stampRadius(0.3)).toBe(2); // 2.4 → 2
  });
  it("clamps smoothness to [0,1]", () => {
    expect(stampRadius(5)).toBe(8); // → 1·8
    expect(stampRadius(-1)).toBe(0);
  });
});

describe("stampPixel", () => {
  it("maps a dark pixel to foreground and a light pixel to background (r=0)", () => {
    // lum ≈ v/65535; balance 0.5 splits at ~32768
    expect(stampPixel([[0]], 0, 0, 0.5, 0, 0, 255)).toBe(0); // dark → fg (0·257)
    expect(stampPixel([[STAMP_MAX]], 0, 0, 0.5, 0, 0, 255)).toBe(65535); // light → bg (255·257)
    expect(stampPixel([[20000]], 0, 0, 0.5, 0, 0, 255)).toBe(0); // lum 0.305 < 0.5 → fg
    expect(stampPixel([[50000]], 0, 0, 0.5, 0, 0, 255)).toBe(65535); // lum 0.763 ≥ 0.5 → bg
  });

  it("widens the 8-bit fg/bg to 16-bit via ·257", () => {
    expect(stampPixel([[0]], 0, 0, 0.5, 0, 50, 200)).toBe(50 * 257); // dark → fg = 12850
    expect(stampPixel([[STAMP_MAX]], 0, 0, 0.5, 0, 50, 200)).toBe(200 * 257); // light → bg = 51400
  });

  it("a higher balance pushes more (brighter) pixels onto the foreground side", () => {
    // mid-grey pixel: lum ≈ 0.46; fg only when lum < balance
    const g = [[30000]];
    expect(stampPixel(g, 0, 0, 0.3, 0, 0, 255)).toBe(65535); // 0.46 ≥ 0.3 → bg
    expect(stampPixel(g, 0, 0, 0.6, 0, 0, 255)).toBe(0); // 0.46 < 0.6 → fg
  });

  it("classifies a pixel sitting exactly on the threshold as background (strict <, not <=)", () => {
    // lum(26214) === clamp01(fround(0.4)) === 0.4000000059604645 exactly, so smoothed == thr.
    // The engine's gate is strict `sum/cnt < thr`, so an equal pixel falls to the LIGHT side
    // (bg); a `<=` mutation would wrongly send it to fg. r=0 keeps smoothed == lum(26214).
    expect(stampPixel([[26214]], 0, 0, 0.4, 0, 0, 255)).toBe(65535);
  });

  it("smoothing averages the neighbourhood luminance before thresholding", () => {
    // a lone bright pixel among dark: at r=0 it is its own (bright) class; with smoothing its
    // luminance is pulled down by the dark neighbours and can flip to the dark class.
    const g = grid(9, 9, (x, y) => (x === 4 && y === 4 ? 65535 : 0));
    expect(stampPixel(g, 4, 4, 0.5, 0, 0, 255)).toBe(65535); // r=0: bright → bg
    expect(stampPixel(g, 4, 4, 0.5, 0.5, 0, 255)).toBe(0); // r=4: averaged ≈ 1/81 < 0.5 → fg
  });
});

describe("stamp2D", () => {
  it("renders a flat dark field entirely foreground and a flat light field entirely background", () => {
    expect(stamp2D(grid(8, 8, () => 10000), 0.5, 0, 0, 255)).toEqual(grid(8, 8, () => 0));
    expect(stamp2D(grid(8, 8, () => 50000), 0.5, 0, 0, 255)).toEqual(grid(8, 8, () => 65535));
  });

  it("emits only the two tones (fg·257 and bg·257)", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % STAMP_MAX);
    for (const [fg, bg] of [
      [0, 255],
      [50, 200],
    ]) {
      const tones = [fg * 257, bg * 257];
      for (const v of flat(stamp2D(g, 0.5, 0.25, fg, bg))) expect(tones).toContain(v);
    }
  });

  it("a higher balance produces at least as many foreground pixels", () => {
    const g = grid(12, 12, (x, y) => Math.floor(((x + y) * STAMP_MAX) / 22));
    const countFg = (b: number) => flat(stamp2D(g, b, 0, 0, 255)).filter((v) => v === 0).length;
    expect(countFg(0.7)).toBeGreaterThan(countFg(0.3));
  });

  it("smoothing changes the result vs no smoothing on a textured image", () => {
    const g = grid(11, 11, (x, y) => (x * 6151 + y * 3079) % STAMP_MAX);
    expect(stamp2D(g, 0.5, 0, 0, 255)).not.toEqual(stamp2D(g, 0.5, 0.5, 0, 255));
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % STAMP_MAX);
    for (const [balance, smoothness] of [
      [0.3, 0],
      [0.5, 0.5],
      [0.7, 1],
    ]) {
      for (const v of flat(stamp2D(g, balance, smoothness, 0, 255))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(STAMP_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(stamp2D([], 0.5, 0.5, 0, 255)).toEqual([]);
    expect(stamp2D([[], []], 0.5, 0.5, 0, 255)).toEqual([[], []]);
    expect(stamp2D([[10000]], 0.5, 0.5, 0, 255)).toEqual([[0]]); // lone dark pixel → fg
    expect(stamp2D([[60000]], 0.5, 0.5, 0, 255)).toEqual([[65535]]); // lone light pixel → bg
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(stamp2D(g, 0.4, 0.5, 50, 200)).toEqual(stamp2D(g, 0.4, 0.5, 50, 200));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % STAMP_MAX);
    const snapshot = g.map((r) => [...r]);
    stamp2D(g, 0.5, 0.25, 0, 255);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = stamp2D(g, 0.5, 0.5, 0, 255);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's stamp on a
//    7×7 grey pattern v = (x·9973 + y·9931) mod 65535. The single-channel luminance model is
//    bit-exact to the engine for grey input. ──
describe("engine golden (stamp, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % STAMP_MAX);

  it("matches the engine bit-exactly — balance 0.5, smoothness 0, black/white (r=0)", () => {
    expect(stamp2D(input, 0.5, 0, 0, 255)).toEqual([
      [0, 0, 0, 0, 65535, 65535, 65535],
      [0, 0, 0, 65535, 65535, 65535, 0],
      [0, 0, 65535, 65535, 65535, 0, 0],
      [0, 65535, 65535, 65535, 0, 0, 0],
      [65535, 65535, 65535, 0, 0, 0, 65535],
      [65535, 65535, 0, 0, 0, 65535, 65535],
      [65535, 0, 0, 0, 65535, 65535, 65535],
    ]);
  });

  it("matches the engine bit-exactly — balance 0.4, smoothness 0.5, grey fg/bg (r=4, ·257)", () => {
    expect(stamp2D(input, 0.4, 0.5, 50, 200)).toEqual([
      [12850, 12850, 51400, 51400, 51400, 51400, 51400],
      [12850, 12850, 51400, 51400, 51400, 51400, 51400],
      [12850, 51400, 51400, 51400, 51400, 51400, 51400],
      [51400, 51400, 51400, 51400, 51400, 51400, 51400],
      [51400, 51400, 51400, 51400, 51400, 51400, 51400],
      [51400, 51400, 51400, 51400, 51400, 51400, 51400],
      [51400, 51400, 51400, 51400, 51400, 51400, 51400],
    ]);
  });
});

// ── Several balance/smoothness/colour fixtures swept for two-tone, shape, flat-classification ──
const FIXTURES: { name: string; balance: number; smoothness: number; fg: number; bg: number }[] = [
  { name: "hard black/white", balance: 0.5, smoothness: 0, fg: 0, bg: 255 },
  { name: "soft grey", balance: 0.45, smoothness: 0.75, fg: 30, bg: 220 },
  { name: "low balance", balance: 0.2, smoothness: 0.25, fg: 10, bg: 245 },
];

describe.each(FIXTURES)("fixture: $name", ({ balance, smoothness, fg, bg }) => {
  it("stays in range, keeps shape, and emits only the two tones", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % STAMP_MAX);
    const out = stamp2D(g, balance, smoothness, fg, bg);
    const tones = [fg * 257, bg * 257];
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(tones).toContain(v);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(STAMP_MAX);
    }
    // a flat field classifies uniformly (one tone)
    expect(new Set(flat(stamp2D(grid(13, 13, () => 33333), balance, smoothness, fg, bg))).size).toBe(1);
  });
});
