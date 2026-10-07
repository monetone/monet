// Unit tests for the Trace Contour filter. Engine-free (node), integer-exact. These pin
// the level threshold (level·257), the 4-connected crossing detection, and the `upper`
// side selection (must match filters.rs trace_contour), plus the defining behaviours: a
// flat region is all white, a level crossing inks a black line on the chosen side, and
// only 4-connected (not diagonal) crossings count.
import { describe, it, expect } from "vitest";
import { contourLevel, isContour, traceContour2D, LEVEL_SCALE, CONTOUR, FLAT } from "./traceContour";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("contourLevel / constants", () => {
  it("scales an 8-bit level to the 16-bit threshold (·257)", () => {
    expect(LEVEL_SCALE).toBe(257);
    expect(contourLevel(0)).toBe(0);
    expect(contourLevel(100)).toBe(25700);
    expect(contourLevel(255)).toBe(65535);
    expect(CONTOUR).toBe(0);
    expect(FLAT).toBe(65535);
  });
});

describe("isContour", () => {
  it("is false off the selected side regardless of neighbours", () => {
    const g = [[100, 60000, 60000]];
    const lv = contourLevel(100); // 25700
    // col 1 is high (>=lv); with upper=false it's off the low side → not a contour
    expect(isContour(g, 1, 0, lv, false)).toBe(false);
    // with upper=true it's on the high side and touches col 0 (low) → contour
    expect(isContour(g, 1, 0, lv, true)).toBe(true);
  });
});

describe("traceContour2D", () => {
  it("a flat region (no level crossing) is all white, both sides", () => {
    const g = grid(5, 5, () => 30000);
    for (const upper of [true, false]) {
      expect(traceContour2D(g, 100, upper).every((r) => r.every((v) => v === FLAT))).toBe(true);
    }
  });

  it("draws the contour on the side selected by `upper`", () => {
    // lv = 25700: cols 0,1 low (100), cols 2,3 high (60000); the crossing is between col 1 and 2
    const g = [[100, 100, 60000, 60000]];
    expect(traceContour2D(g, 100, true)).toEqual([[FLAT, FLAT, CONTOUR, FLAT]]); // high side → col 2
    expect(traceContour2D(g, 100, false)).toEqual([[FLAT, CONTOUR, FLAT, FLAT]]); // low side → col 1
  });

  it("treats a value exactly at the threshold as 'above'", () => {
    const g = [[25700 - 1, 25700, 25700 + 1]]; // below, at(=above), above for level 100
    expect(traceContour2D(g, 100, true)).toEqual([[FLAT, CONTOUR, FLAT]]); // the 'at' pixel touches 'below'
  });

  it("detects only 4-connected crossings (diagonal neighbours don't count)", () => {
    // a lone high corner in a low field
    const g = grid(3, 3, (x, y) => (x === 0 && y === 0 ? 60000 : 100));
    const out = traceContour2D(g, 100, false); // low side
    expect(out[1][1]).toBe(FLAT); // centre: only the diagonal (0,0) is high → no 4-connected crossing
    expect(out[0][1]).toBe(CONTOUR); // 4-connected to the high corner → inked
    expect(out[1][0]).toBe(CONTOUR);
    expect(out[0][0]).toBe(FLAT); // the high corner itself is off the low side
  });

  it("edge-clamps: a crossing at the image border is still traced", () => {
    // left half low, right half high; the high block touches the right border
    const g = grid(4, 4, (x) => (x < 2 ? 1000 : 50000));
    const hi = traceContour2D(g, 100, true); // lv=25700, high side
    // col 2 (high, left neighbour col 1 low) → contour; col 3 (high, all neighbours high incl. clamped) → white
    for (let y = 0; y < 4; y++) {
      expect(hi[y][2]).toBe(CONTOUR);
      expect(hi[y][3]).toBe(FLAT);
      expect(hi[y][0]).toBe(FLAT);
      expect(hi[y][1]).toBe(FLAT);
    }
  });

  it("level 0 traces nothing (everything is 'above') → all white", () => {
    const g = grid(4, 4, (x, y) => (x * 31 + y * 17) % 65535);
    expect(traceContour2D(g, 0, true).every((r) => r.every((v) => v === FLAT))).toBe(true);
  });

  it("every output is exactly 0 or 65535", () => {
    const g = grid(7, 9, (x, y) => (x * 6151 + y * 3079) % 65535);
    for (const upper of [true, false]) {
      for (const v of flat(traceContour2D(g, 128, upper))) {
        expect(v === CONTOUR || v === FLAT).toBe(true);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(traceContour2D([], 100, true)).toEqual([]);
    expect(traceContour2D([[], []], 100, false)).toEqual([[], []]);
    expect(traceContour2D([[40000]], 100, true)).toEqual([[FLAT]]); // lone pixel: all neighbours clamp to self → no crossing
    const g = grid(6, 6, (x, y) => (x * 53 + y * 97) % 60000);
    expect(traceContour2D(g, 120, true)).toEqual(traceContour2D(g, 120, true));
  });

  it("does not mutate the input", () => {
    const g = grid(5, 5, (x, y) => (x + y) * 5000);
    const snapshot = g.map((row) => [...row]);
    traceContour2D(g, 100, true);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(3, 9, (x, y) => (x * 11 + y * 5) % 50000);
    const out = traceContour2D(g, 80, false);
    expect(out.length).toBe(3);
    expect(out.every((row) => row.length === 9)).toBe(true);
  });

  it("the upper-side and lower-side contours are disjoint (a pixel is on at most one side)", () => {
    // on_side is `cAbove` (upper) vs `!cAbove` (lower) — mutually exclusive — so no pixel
    // can be inked black in BOTH maps for the same level.
    const g = grid(8, 8, (x, y) => (x * 6151 + y * 3079) % 65535);
    const up = traceContour2D(g, 128, true);
    const lo = traceContour2D(g, 128, false);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(up[y][x] === CONTOUR && lo[y][x] === CONTOUR).toBe(false);
      }
    }
  });

  it("level 255 traces only the boundary of a pure-white (65535) region", () => {
    // lv = 65535 → only c == 65535 is 'above'; a white block adjacent to lower values inks
    const g = grid(4, 4, (x) => (x < 2 ? 65535 : 30000));
    const out = traceContour2D(g, 255, true); // high side = the 65535 columns
    for (let y = 0; y < 4; y++) {
      expect(out[y][1]).toBe(CONTOUR); // white col 1 touches lower col 2 → inked
      expect(out[y][0]).toBe(FLAT); // deep in the white block → no crossing
      expect(out[y][3]).toBe(FLAT); // the low region is off the high side → white
    }
  });
});

// ── Several level/side/image fixtures swept for binary (0/65535) output + shape ──
const FIXTURES: { name: string; level: number; upper: boolean }[] = [
  { name: "low level high side", level: 40, upper: true },
  { name: "mid level low side", level: 128, upper: false },
  { name: "high level high side", level: 200, upper: true },
];

describe.each(FIXTURES)("fixture: $name", ({ level, upper }) => {
  it("produces a binary (0/65535) contour map of the same shape", () => {
    const g = grid(10, 12, (x, y) => Math.round((Math.sin(x / 2) + Math.cos(y / 2) + 2) * 16000));
    const out = traceContour2D(g, level, upper);
    expect(out.length).toBe(10);
    expect(out.every((row) => row.length === 12)).toBe(true);
    for (const v of flat(out)) expect(v === CONTOUR || v === FLAT).toBe(true);
  });
});
