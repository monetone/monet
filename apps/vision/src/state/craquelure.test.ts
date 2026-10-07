// Unit tests for the Craquelure filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input). These pin the noise frequency, the groove/ridge/plaster shade selection (the
// crack level-set of tex_noise), the depth/brightness scaling, and the depth≤0 no-op (must match
// filters.rs craquelure), plus cross-implementation goldens captured from the Rust engine. Fully
// bit-exact (reuses the integer-hash tex_noise; no trig/sqrt).
import { describe, it, expect } from "vitest";
import { craquelureFreq, craquelureShade, craquelure2D, CRAQUELURE_MAX } from "./craquelure";

const fr = Math.fround;
const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("craquelureFreq", () => {
  it("is 1/max(spacing,2) — wider spacing is lower frequency, spacing < 2 is clamped", () => {
    expect(craquelureFreq(6)).toBe(fr(1 / 6));
    expect(craquelureFreq(3)).toBe(fr(1 / 3));
    expect(craquelureFreq(8)).toBe(fr(1 / 8));
    expect(craquelureFreq(1)).toBe(fr(1 / 2)); // spacing clamped up to 2
    expect(craquelureFreq(0)).toBe(fr(1 / 2));
  });
});

describe("craquelureShade", () => {
  it("is a dark groove at the crack centre, a light ridge beside it, and 0 on the plaster", () => {
    expect(craquelureShade(0, 0.7, 0.5)).toBe(fr(-0.7 * 65535)); // crack centre: darkest groove
    expect(craquelureShade(0, 0.7, 0.5)).toBeLessThan(0);
    // d EXACTLY equal to the f32 half-width is the strict-`<` boundary: the engine's `if d < half`
    // is false there ⇒ ridge (0.5·65535). A `d <= half` mutant would take the groove branch and
    // return −0 instead. (NB: the f64 literal 0.06 is > fr(0.06), so it would NOT hit the boundary.)
    expect(craquelureShade(fr(0.06), 0.7, 0.5)).toBe(fr(0.5 * 65535)); // d == half → ridge (≥-mutant → −0)
    expect(craquelureShade(0.0599, 0.7, 0.5)).toBeLessThan(0); // just inside half → still groove
    expect(craquelureShade(0.5, 0.7, 0.5)).toBe(0); // far from any crack → plaster (unchanged)
    expect(craquelureShade(0.13, 0.7, 0.5)).toBe(0); // d ≥ 2·half → plaster
  });
  it("the groove deepens with depth and the ridge brightens with brightness", () => {
    expect(craquelureShade(0, 1, 0.5)).toBeLessThan(craquelureShade(0, 0.5, 0.5)); // deeper (more negative)
    expect(craquelureShade(0.06, 0.7, 1)).toBeGreaterThan(craquelureShade(0.06, 0.7, 0.5)); // brighter ridge
  });
});

describe("craquelurePixel / craquelure2D", () => {
  const g = grid(16, 16, (x, y) => (x * 9973 + y * 9931) % CRAQUELURE_MAX);

  it("depth ≤ 0 is a no-op", () => {
    expect(craquelure2D(g, 6, 0, 0.5)).toEqual(g);
    expect(craquelure2D(g, 6, -0.3, 0.5)).toEqual(g);
  });

  it("leaves plaster pixels (far from a crack) unchanged", () => {
    // most pixels are plaster: count how many are unchanged — should be the majority.
    const out = craquelure2D(g, 6, 0.7, 0.5);
    let unchanged = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (out[y][x] === g[y][x]) unchanged++;
    expect(unchanged).toBeGreaterThan(256 / 2); // cracks are sparse
  });

  it("keeps every output an integer within [0, 65535]", () => {
    for (const [sp, dp, br] of [
      [6, 0.7, 0.5],
      [3, 1, 0.8],
      [10, 0.4, 0.2],
    ]) {
      for (const v of flat(craquelure2D(g, sp, dp, br))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(CRAQUELURE_MAX);
      }
    }
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(craquelure2D([], 6, 0.7, 0.5)).toEqual([]);
    expect(craquelure2D([[], []], 6, 0.7, 0.5)).toEqual([[], []]);
    const snapshot = g.map((r) => [...r]);
    const out = craquelure2D(g, 6, 0.7, 0.5);
    expect(g).toEqual(snapshot);
    expect(craquelure2D(g, 6, 0.7, 0.5)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const ng = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = craquelure2D(ng, 4, 0.8, 0.5);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's craquelure on a
//    16×16 grey pattern v = (x·9973 + y·9931) mod 65535 (coords reach 15). The sparse crack network
//    cuts dark grooves (toward 0) and light ridges (toward 65535) while plaster keeps the image.
//    Fully bit-exact (no trig/sqrt). ──
describe("engine golden (craquelure, 16×16 grey)", () => {
  const g = grid(16, 16, (x, y) => (x * 9973 + y * 9931) % CRAQUELURE_MAX);
  const rows = (vals: number[]): number[][] => Array.from({ length: 16 }, (_, y) => vals.slice(y * 16, y * 16 + 16));

  it("matches the engine bit-exactly — spacing 6, depth 0.7, brightness 0.5", () => {
    expect(craquelure2D(g, 6, 0.7, 0.5)).toEqual(
      rows([
        0, 9973, 19946, 29919, 39892, 49865, 59838, 4276, 14249, 24222, 34195, 44168, 54141, 64114, 8552, 18525, 9931,
        19904, 29877, 39850, 49823, 59796, 4234, 14207, 24180, 34153, 44126, 54099, 64072, 8510, 18483, 28456, 19862,
        29835, 39808, 49781, 59754, 4192, 14165, 24138, 34111, 44084, 54057, 64030, 8468, 18441, 28414, 38387, 29793,
        39766, 49739, 65535, 0, 0, 0, 4065, 23351, 45433, 65535, 32022, 39333, 47529, 53059, 57257, 0, 15075, 49987,
        20634, 14081, 24054, 34027, 44000, 53973, 65535, 32180, 11537, 13759, 22376, 28958, 34523, 49655, 59628, 4066,
        14039, 24012, 33985, 43958, 53931, 63904, 8342, 18315, 28288, 38261, 48234, 58207, 2645, 59586, 4024, 13997,
        23970, 33943, 43916, 53889, 63862, 8300, 18273, 28246, 38219, 48192, 58165, 2603, 12576, 3982, 13955, 23928,
        33901, 43874, 53847, 63820, 8258, 18231, 28204, 38177, 48150, 58123, 2561, 12534, 22507, 28340, 32653, 33859,
        43832, 53805, 63778, 8216, 18189, 28162, 38135, 48108, 58081, 2519, 12492, 22465, 35113, 0, 4371, 25055, 48952,
        65535, 26781, 33694, 38353, 38093, 48066, 58039, 2477, 12450, 22423, 32396, 65535, 65535, 65535, 52852, 60732,
        3077, 11440, 20769, 13902, 22524, 65535, 2435, 12408, 22381, 32354, 42327, 13960, 43706, 53679, 63652, 8090,
        18063, 28036, 38009, 47982, 49893, 0, 12366, 22339, 32312, 42285, 56681, 39770, 53637, 63610, 8048, 18021, 27994,
        37967, 47940, 57913, 24251, 0, 22297, 32270, 42243, 52216, 65535, 0, 63568, 8006, 17979, 27952, 37925, 47898,
        57871, 2309, 32445, 0, 32522, 42201, 52174, 62147, 27114, 11409, 7964, 17937, 27910, 37883, 47856, 57829, 2267,
        12240, 38033, 4000, 30507, 64699, 63263, 22853, 0, 54125, 18959, 28539, 37841, 47814, 57787, 2225, 12198, 22171,
        42318, 65535, 46241, 41799, 0, 0, 25951, 52605,
      ]),
    );
  });

  it("matches the engine bit-exactly — spacing 3, depth 1, brightness 0.8", () => {
    expect(craquelure2D(g, 3, 1, 0.8)).toEqual(
      rows([
        0, 9973, 19946, 29919, 39892, 49865, 59838, 4276, 14249, 24222, 34195, 44168, 54141, 65535, 8339, 18525, 9931,
        19904, 29877, 39850, 49823, 59796, 4234, 14207, 24180, 34153, 44126, 65535, 16995, 0, 18483, 28456, 0, 16002,
        39808, 49781, 59754, 42266, 0, 0, 0, 0, 65535, 64030, 8468, 18441, 28414, 38387, 29793, 39766, 49739, 59712,
        4150, 14123, 24096, 34069, 44042, 54015, 63988, 8426, 18399, 28372, 38345, 48318, 62807, 49697, 59670, 4108,
        14081, 24054, 34027, 44000, 65535, 32647, 30176, 18357, 28330, 38303, 48276, 58249, 65535, 58387, 0, 3598, 0,
        33985, 43958, 53931, 65535, 8342, 18315, 65535, 0, 65535, 58207, 2645, 59586, 4024, 13997, 23970, 65535, 43916,
        53889, 65535, 8300, 18273, 28246, 38219, 48192, 52686, 2603, 12576, 3982, 13955, 23928, 33901, 65535, 37201,
        65535, 0, 18231, 28204, 38177, 48150, 65535, 0, 12534, 22507, 27158, 40181, 55818, 65535, 61051, 63778, 8216,
        18189, 60330, 30351, 20252, 0, 0, 58354, 22465, 32438, 49520, 65535, 65535, 45236, 63736, 8174, 18147, 28120,
        18495, 44639, 65535, 43819, 48952, 30821, 32396, 42369, 0, 0, 47797, 65535, 0, 18105, 28078, 38051, 13279, 39153,
        0, 3633, 17130, 65535, 42327, 52300, 65535, 53679, 63652, 8090, 18063, 11530, 34325, 23580, 0, 0, 0, 0, 0, 1679,
        32757, 54094, 53637, 63610, 8048, 18021, 27994, 37967, 23030, 23155, 0, 0, 0, 0, 0, 0, 0, 0, 63568, 8006, 17979,
        27952, 37925, 62086, 29037, 0, 48974, 45366, 65535, 17033, 5372, 16333, 38530, 17740, 7964, 17937, 54644, 0, 0,
        12821, 0, 40131, 22213, 32186, 42159, 52980, 65535, 0, 16516, 26489, 17895, 27868, 0, 47814, 57787, 0, 0, 31742,
        32144, 42117, 52090, 62063, 27056, 2593, 26447, 36420,
      ]),
    );
  });
});
