// Unit tests for the Texture Grain filter. Engine-free (node), single grey value-channel + grey
// background model. These pin the integer value-hash (u32 wrapping arithmetic via Math.imul), the
// smooth value noise, the nine grain-type formulas, the additive/speck application, and the
// intensity-0 no-op (must match filters.rs texture_grain + tex_hash/tex_noise), plus cross-
// implementation goldens captured from the Rust engine for every grain type. Fully bit-exact.
import { describe, it, expect } from "vitest";
import { texHash, texNoise, textureGrainDelta, textureGrain2D, TEXTURE_GRAIN_MAX } from "./textureGrain";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const HASH_MAX = 65535;

describe("texHash", () => {
  it("reproduces the engine's u32 wrapping hash exactly (incl. negative lattice coords)", () => {
    // raw = round(hash·65535); captured from the Rust engine's tex_hash.
    const raw = (ix: number, iy: number) => Math.round(texHash(ix, iy) * HASH_MAX);
    expect(raw(0, 0)).toBe(0);
    expect(raw(1, 0)).toBe(5363);
    expect(raw(0, 1)).toBe(44384);
    expect(raw(7, 3)).toBe(52543);
    expect(raw(13, 29)).toBe(48867);
    expect(raw(255, 255)).toBe(45178);
    expect(raw(-1, -1)).toBe(58090);
    expect(raw(100, 7)).toBe(44763);
  });
  it("stays in [0,1]", () => {
    for (let ix = 0; ix < 40; ix++) for (let iy = 0; iy < 40; iy++) {
      const v = texHash(ix, iy);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("texNoise", () => {
  it("equals the lattice hash at integer coordinates (fractions vanish)", () => {
    for (const [x, y] of [[0, 0], [3, 5], [7, 2], [12, 9]]) {
      expect(texNoise(x, y)).toBe(texHash(x, y));
    }
  });
  it("stays in [0,1] between lattice points", () => {
    for (let i = 0; i < 50; i++) {
      const v = texNoise(i * 0.37, i * 0.61);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("textureGrainDelta", () => {
  it("the Regular delta is (hash−0.5)·2 ∈ [−1,1]", () => {
    for (const [x, y] of [[0, 0], [3, 5], [10, 2]]) {
      expect(textureGrainDelta(x, y, 0, 0.5)).toBe(Math.fround(Math.fround(texHash(x, y) - 0.5) * 2));
    }
  });
  it("Contrasty (type 4) saturates to [−1,1]", () => {
    for (let x = 0; x < 30; x++) {
      const d = textureGrainDelta(x, 0, 4, 0.5);
      expect(d).toBeGreaterThanOrEqual(-1);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
  it("Horizontal (type 7) is constant per row; Vertical (type 8) constant per column", () => {
    expect(textureGrainDelta(0, 4, 7, 0.5)).toBe(textureGrainDelta(9, 4, 7, 0.5)); // same row
    expect(textureGrainDelta(4, 0, 8, 0.5)).toBe(textureGrainDelta(4, 9, 8, 0.5)); // same column
  });
});

describe("textureGrainPixel / textureGrain2D", () => {
  const g = grid(8, 8, (x, y) => (x * 9973 + y * 9931) % TEXTURE_GRAIN_MAX);

  it("intensity ≤ 0 is a no-op for every grain type", () => {
    for (let gt = 0; gt <= 9; gt++) {
      expect(textureGrain2D(g, 0, 0.5, gt, 200)).toEqual(g);
      expect(textureGrain2D(g, -0.5, 0.5, gt, 200)).toEqual(g);
    }
  });

  it("keeps every output an integer within [0, 65535]", () => {
    for (let gt = 0; gt <= 9; gt++) {
      for (const v of flat(textureGrain2D(g, 0.7, 0.6, gt, 200))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(TEXTURE_GRAIN_MAX);
      }
    }
  });

  it("is deterministic (position-driven, no RNG state) and does not mutate the input", () => {
    const snapshot = g.map((r) => [...r]);
    const out = textureGrain2D(g, 0.5, 0.5, 0, 200);
    expect(g).toEqual(snapshot);
    expect(textureGrain2D(g, 0.5, 0.5, 0, 200)).toEqual(out);
  });

  it("handles empty / 1×1 images and is shape-preserving (non-square)", () => {
    expect(textureGrain2D([], 0.5, 0.5, 0, 200)).toEqual([]);
    expect(textureGrain2D([[], []], 0.5, 0.5, 0, 200)).toEqual([[], []]);
    const ng = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = textureGrain2D(ng, 0.5, 0.5, 1, 200);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's texture_grain
//    on an 8×8 grey pattern v = (x·9973 + y·9931) mod 65535, intensity 0.5, contrast 0.5, grey
//    background 200, for ALL ten grain types (0 Regular … 9 Speckle). Fully bit-exact (integer
//    hash + bilinear smoothstep; no trig). ──
const GOLDENS: Record<number, number[]> = {
  0: [0, 0, 285, 10258, 26317, 60965, 40177, 23936, 23870, 39564, 43480, 53263, 65535, 65535, 0, 32888, 8420, 13844, 59468, 30120, 47639, 22126, 0, 11743, 22666, 35661, 30078, 64183, 10301, 30030, 12767, 53729, 51745, 65535, 62595, 4298, 13246, 24065, 15719, 24339, 65535, 46206, 5901, 33699, 31599, 14324, 55243, 34270, 65535, 0, 33657, 7955, 22195, 45468, 34228, 65535, 23642, 33615, 33883, 14240, 26298, 61226, 65535, 27918],
  1: [0, 0, 285, 10258, 20231, 30204, 40177, 0, 0, 243, 10216, 20189, 30162, 40135, 0, 0, 7171, 18932, 32838, 46744, 58504, 2134, 10329, 18523, 35410, 47709, 62798, 65535, 23810, 32568, 38019, 43470, 53663, 65535, 65535, 23768, 33741, 43714, 53687, 60226, 59628, 65535, 20623, 33699, 43672, 53645, 62943, 65535, 60835, 6202, 18220, 30238, 41141, 52728, 65535, 65535, 0, 6281, 15818, 25355, 35129, 49629, 65535, 23957],
  2: [0, 9973, 19946, 29919, 39892, 49865, 59838, 4276, 9931, 19904, 29877, 39850, 49823, 59796, 4234, 14207, 19862, 46008, 48502, 50995, 59754, 4192, 14165, 44584, 29793, 39766, 49739, 59712, 4150, 14123, 24096, 34069, 39724, 49697, 59670, 4108, 42070, 24054, 34027, 44000, 49655, 59628, 4066, 14039, 24012, 33985, 43958, 53931, 59586, 4024, 13997, 23970, 33943, 43916, 53889, 63862, 3982, 13955, 23928, 33901, 43874, 53847, 63820, 8258],
  3: [0, 0, 285, 10258, 20231, 30204, 40177, 0, 0, 243, 11146, 20339, 30162, 40135, 0, 0, 11036, 25278, 39778, 46149, 52614, 0, 8266, 23784, 18626, 30272, 42228, 55489, 3330, 7831, 12252, 27420, 26859, 35916, 45339, 0, 20281, 18679, 16980, 31812, 42609, 52647, 0, 10522, 23624, 32214, 40693, 53756, 57898, 3380, 14874, 20582, 26466, 45234, 63876, 65535, 10348, 24134, 38437, 42657, 47068, 61852, 65535, 21987],
  4: [0, 0, 285, 10258, 20231, 65535, 40177, 23936, 29591, 39564, 49537, 59510, 65535, 65535, 0, 33867, 201, 10174, 59468, 30120, 40093, 23852, 0, 4477, 15540, 31556, 30078, 65535, 16453, 33783, 4435, 53729, 59384, 65535, 65520, 4488, 12411, 24076, 14366, 24339, 65535, 39967, 7736, 33699, 39186, 14324, 63618, 34270, 65535, 0, 33657, 4309, 14282, 47020, 34228, 65535, 23642, 33615, 43588, 14240, 24213, 65535, 65535, 27918],
  5: [0, 0, 285, 10258, 20231, 30204, 40177, 0, 0, 243, 10216, 20189, 30162, 40135, 0, 0, 201, 10174, 20147, 30120, 40093, 0, 0, 4477, 10132, 20105, 30078, 40051, 0, 0, 4435, 14408, 20063, 30036, 40009, 0, 0, 4393, 14366, 24339, 29994, 39967, 0, 0, 4351, 14324, 24297, 34270, 39925, 0, 0, 4309, 14282, 24255, 34228, 44201, 0, 0, 4267, 14240, 24213, 34186, 44159, 0],
  6: [0, 9973, 19946, 29919, 39892, 49865, 59838, 39619, 9931, 43526, 29877, 39850, 51005, 53499, 4234, 14207, 19862, 29835, 48502, 49781, 59754, 4192, 14165, 24138, 29793, 39766, 49739, 59712, 4150, 14123, 24096, 47067, 39724, 50974, 59670, 4108, 14081, 24054, 34027, 44000, 50963, 59628, 4066, 42059, 24012, 33985, 43958, 53931, 53446, 4024, 42049, 23970, 33943, 43916, 53889, 63862, 39545, 42038, 23928, 33901, 43874, 53847, 63820, 40614],
  7: [0, 0, 285, 10258, 20231, 30204, 40177, 0, 23870, 33843, 43816, 53789, 63762, 65535, 18173, 28146, 8420, 18393, 28366, 38339, 48312, 0, 2723, 12696, 22666, 32639, 42612, 52585, 0, 6996, 16969, 26942, 51745, 61718, 65535, 16128, 26102, 36075, 46048, 56021, 65535, 65535, 23726, 33699, 43672, 53645, 63618, 65535, 65535, 23684, 33657, 43630, 53603, 63576, 65535, 65535, 23642, 33615, 43588, 53561, 63534, 65535, 65535, 27918],
  8: [0, 0, 285, 10258, 26317, 60965, 40177, 23936, 0, 243, 10216, 20189, 36248, 65535, 0, 33867, 201, 10174, 20147, 30120, 46179, 15292, 0, 43798, 10132, 20105, 30078, 40051, 0, 25223, 4435, 53729, 20063, 30036, 40009, 0, 506, 35154, 14366, 63660, 29994, 39967, 0, 0, 10437, 45085, 24297, 65535, 39925, 0, 0, 4309, 20368, 55016, 34228, 65535, 0, 0, 4267, 14240, 30299, 64947, 44159, 27918],
  9: [19660, 29633, 19946, 49579, 39892, 49865, 40177, 4276, 9931, 19904, 29877, 39850, 49823, 59796, 4234, 14207, 19862, 29835, 39808, 65535, 59754, 4192, 14165, 24138, 29793, 39766, 49739, 59712, 4150, 14123, 24096, 34069, 39724, 49697, 59670, 4108, 14081, 24054, 34027, 44000, 49655, 59628, 4066, 14039, 24012, 53645, 43958, 34270, 59586, 0, 13997, 23970, 33943, 43916, 34228, 63862, 3982, 13955, 23928, 53561, 43874, 53847, 63820, 8258],
};

describe("engine golden (texture_grain, 8×8 grey, intensity 0.5, contrast 0.5, bg 200)", () => {
  const g = grid(8, 8, (x, y) => (x * 9973 + y * 9931) % TEXTURE_GRAIN_MAX);
  it.each(Object.keys(GOLDENS).map(Number))("matches the engine bit-exactly — grain type %i", (gt) => {
    const expected = Array.from({ length: 8 }, (_, y) => GOLDENS[gt].slice(y * 8, y * 8 + 8));
    expect(textureGrain2D(g, 0.5, 0.5, gt, 200)).toEqual(expected);
  });
});

// ── Large-coordinate regression: the octave noise scales (0.12 for Clumped, 0.05 for Enlarged)
//    must be f32 BEFORE the multiply (the engine does `x as f32 · 0.12`). At pixel (20,13) the
//    engine value is 8173 / 13448; a mirror using f64 literals computes 8172 / 13447. The 8×8
//    goldens (coords ≤7) can't reach this, so this pins the f32-constant fix. ──
describe("engine golden (texture_grain, large coords pin the f32 octave scale)", () => {
  const g = grid(16, 24, (x, y) => (x * 9973 + y * 9931) % TEXTURE_GRAIN_MAX);
  it("Clumped (type 3) at (20,13) is 8173 (f64 literal would give 8172)", () => {
    expect(textureGrain2D(g, 0.5, 0.5, 3, 200)[13][20]).toBe(8173);
  });
  it("Enlarged (type 5) at (20,13) is 13448 (f64 literal would give 13447)", () => {
    expect(textureGrain2D(g, 0.5, 0.5, 5, 200)[13][20]).toBe(13448);
  });
});

// ── Second operating point (intensity 0.8, contrast 0.2, bg 64): pins the amp = it·0.6·65535,
//    cgain = 1+2·ct, thr = 1−it·0.5 and blend = 0.5+0.5·ct formulas, which the it=0.5/ct=0.5
//    goldens alone leave under-determined. Types 0 (additive), 2 (speck) and 4 (contrasty). ──
describe("engine golden (texture_grain, 8×8 grey, intensity 0.8, contrast 0.2, bg 64)", () => {
  const g = grid(8, 8, (x, y) => (x * 9973 + y * 9931) % TEXTURE_GRAIN_MAX);
  const GOLDENS2: Record<number, number[]> = {
    0: [0, 0, 0, 0, 24688, 62297, 28381, 33640, 25543, 51360, 45113, 54872, 65535, 65535, 0, 35129, 7047, 11925, 63834, 18324, 46185, 24278, 0, 10256, 21811, 35168, 21140, 64720, 11040, 31939, 11407, 60647, 53187, 65535, 62946, 4321, 13146, 24066, 13522, 15345, 65535, 44596, 6121, 45212, 32509, 2528, 56597, 22474, 65535, 0, 45453, 6033, 20785, 45654, 22432, 65535, 30669, 45411, 35078, 2444, 24189, 62111, 65535, 39714],
    2: [0, 9973, 19946, 29919, 39892, 49865, 59838, 4276, 9931, 19904, 29877, 39850, 49823, 59796, 4234, 14207, 17813, 21802, 25792, 29781, 33770, 11545, 15534, 19524, 29793, 39766, 49739, 33753, 11528, 14123, 24096, 34069, 39724, 49697, 59670, 4108, 15501, 24054, 34027, 44000, 49655, 59628, 4066, 14039, 24012, 33985, 43958, 53931, 59586, 4024, 13997, 23970, 33943, 43916, 53889, 63862, 3982, 15450, 19440, 33901, 43874, 53847, 63820, 8258],
    4: [0, 0, 0, 0, 9484, 65535, 28381, 35732, 41156, 51360, 60349, 65535, 65535, 65535, 0, 45663, 0, 0, 65535, 18324, 32617, 35648, 0, 0, 13830, 30571, 18282, 65535, 17930, 45579, 0, 65525, 65535, 65535, 65535, 4534, 12211, 24079, 2570, 12543, 65535, 29564, 8177, 45495, 41006, 2528, 65535, 22474, 65535, 0, 45453, 0, 7628, 47392, 22432, 65535, 35438, 45411, 46228, 2444, 12417, 65535, 65535, 39714],
  };
  it.each(Object.keys(GOLDENS2).map(Number))("matches the engine bit-exactly — grain type %i", (gt) => {
    const expected = Array.from({ length: 8 }, (_, y) => GOLDENS2[gt].slice(y * 8, y * 8 + 8));
    expect(textureGrain2D(g, 0.8, 0.2, gt, 64)).toEqual(expected);
  });
});
