// Unit tests for the Kuwahara edge-preserving smoothing filter. Engine-free (node), single
// grey-channel model (exact for grey R=G=B input). These pin the four overlapping quadrant
// regions, the lowest-variance arg-min selection (a HARD decision — strict `<`, first quad wins
// ties), the region-mean output TRUNCATED to u16, and the radius<1 no-op (must match filters.rs
// kuwahara), plus cross-implementation goldens captured from the Rust engine. The goldens
// exercise the arg-min and are fround-sensitive: a no-fround (f64) mirror flips the selected
// region on many pixels, so they enforce the per-op f32 order.
import { describe, it, expect } from "vitest";
import { kuwaharaPixel, kuwahara2D, KUWAHARA_MAX } from "./kuwahara";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("kuwaharaPixel", () => {
  const g = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % KUWAHARA_MAX);

  it("is the identity when radius < 1 (engine early return)", () => {
    expect(kuwaharaPixel(g, 3, 3, 0)).toBe(g[3][3]);
    expect(kuwaharaPixel(g, 3, 3, -2)).toBe(g[3][3]);
  });

  it("TRUNCATES the region mean (does not round)", () => {
    // r=1 at (1,0): the chosen region's mean is 14959.x → trunc 14959; a rounding mutant → 14960.
    expect(kuwaharaPixel(g, 1, 0, 1)).toBe(14959);
  });

  it("selects the flat (lowest-variance) region across a sharp edge", () => {
    // vertical step: left (x<3)=1000, right=60000. A pixel just inside each side must take that
    // side's uniform mean exactly — never an averaged-across-the-edge value.
    const step = grid(7, 7, (x) => (x < 3 ? 1000 : 60000));
    expect(kuwaharaPixel(step, 1, 3, 2)).toBe(1000); // deep in the dark region
    expect(kuwaharaPixel(step, 5, 3, 2)).toBe(60000); // deep in the bright region
  });
});

describe("kuwahara2D", () => {
  it("is a no-op when radius < 1", () => {
    const g = grid(8, 8, (x, y) => (x * 6151 + y * 3079) % KUWAHARA_MAX);
    expect(kuwahara2D(g, 0)).toEqual(g);
    expect(kuwahara2D(g, -1)).toEqual(g);
  });

  it("leaves a flat field unchanged (every region has zero variance ⇒ mean = the constant)", () => {
    const g = grid(8, 8, () => 40000);
    expect(kuwahara2D(g, 2)).toEqual(g);
    expect(kuwahara2D(g, 3)).toEqual(g);
  });

  it("preserves a sharp edge: only the two flat values appear, never an intermediate", () => {
    const step = grid(7, 9, (x) => (x < 4 ? 1000 : 60000));
    const out = kuwahara2D(step, 2);
    for (const v of flat(out)) expect(v === 1000 || v === 60000).toBe(true);
    // the far columns stay firmly on their side
    for (let y = 0; y < 7; y++) {
      expect(out[y][0]).toBe(1000);
      expect(out[y][8]).toBe(60000);
    }
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % KUWAHARA_MAX);
    for (const r of [1, 2, 4]) {
      for (const v of flat(kuwahara2D(g, r))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(KUWAHARA_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(kuwahara2D([], 2)).toEqual([]);
    expect(kuwahara2D([[], []], 2)).toEqual([[], []]);
    expect(kuwahara2D([[42]], 2)).toEqual([[42]]); // lone pixel: every quad sees only it → 42
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(kuwahara2D(g, 2)).toEqual(kuwahara2D(g, 2));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % KUWAHARA_MAX);
    const snapshot = g.map((r) => [...r]);
    kuwahara2D(g, 2);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = kuwahara2D(g, 2);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's kuwahara on a
//    7×7 grey pattern v = (x·9973 + y·9931) mod 65535, for radii 1/2/3. These exercise the
//    lowest-variance arg-min (different quadrants win at different pixels) and the truncating
//    output. Fully bit-exact (no trig/sqrt); a no-fround f64 mirror flips the selected region on
//    many pixels, so these also enforce the per-op f32 order. ──
describe("engine golden (kuwahara, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % KUWAHARA_MAX);
  const asRows = (vals: number[]): number[][] => Array.from({ length: 7 }, (_, y) => vals.slice(y * 7, y * 7 + 7));

  it("matches the engine bit-exactly — radius 1", () => {
    expect(kuwahara2D(input, 1)).toEqual(
      asRows([
        0, 14959, 24932, 24932, 34905, 44878, 59838, 14896, 9952, 29898, 29898, 39871, 49844, 9199,
        14896, 29814, 29856, 39829, 49802, 14144, 9199, 34758, 29814, 49760, 49760, 14102, 14144, 19130,
        34758, 39745, 49718, 14060, 24033, 24033, 38992, 44689, 49676, 14018, 23991, 24033, 43937, 38992,
        59586, 9010, 9010, 28956, 28956, 38929, 53889,
      ]),
    );
  });

  it("matches the engine bit-exactly — radius 2", () => {
    expect(kuwahara2D(input, 2)).toEqual(
      asRows([
        0, 3324, 9973, 19946, 49865, 56513, 59838, 3310, 6634, 13283, 23256, 33229, 43202, 14165,
        9931, 13255, 19904, 29877, 39850, 20771, 24096, 39724, 43048, 29835, 39808, 24054, 30702, 14165,
        49655, 33117, 39766, 24012, 33985, 40633, 24096, 56275, 43048, 20659, 30632, 40605, 47254, 50578,
        59586, 13997, 23970, 13997, 23970, 50564, 53889,
      ]),
    );
  });

  it("matches the engine bit-exactly — radius 3", () => {
    expect(kuwahara2D(input, 3)).toEqual(
      asRows([
        0, 2493, 7479, 44878, 52358, 57344, 59838, 2482, 4976, 9962, 17442, 27415, 37388, 19130,
        7448, 9941, 14928, 22407, 32380, 26568, 29061, 44689, 17389, 22376, 29856, 31512, 36499, 38992,
        52137, 27320, 32307, 31481, 38961, 43947, 46440, 57103, 37251, 26473, 36446, 43926, 48913, 51406,
        59586, 18983, 28956, 38929, 46409, 51395, 53889,
      ]),
    );
  });
});

// ── Several radius fixtures swept for in-range, shape, flat-invariance ──
const FIXTURES = [1, 2, 3, 5];

describe.each(FIXTURES)("fixture: radius %i", (r) => {
  it("stays in range, keeps shape, and leaves a flat field untouched", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % KUWAHARA_MAX);
    const out = kuwahara2D(g, r);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(KUWAHARA_MAX);
    }
    expect(kuwahara2D(grid(13, 13, () => 22222), r)).toEqual(grid(13, 13, () => 22222));
  });
});
