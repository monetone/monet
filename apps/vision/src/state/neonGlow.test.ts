// Unit tests for the Neon Glow filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input with a grey glow colour). These pin the mid split (clamp(0.5+0.4·size,0.1,0.9)),
// the two luminance ramps (black→glow in shadows, glow→white in highlights, meeting at mid), the
// glow colour/brightness scaling, and the truncating output (must match filters.rs neon_glow),
// plus cross-implementation goldens captured from the Rust engine.
import { describe, it, expect } from "vitest";
import { neonGlowMid, neonGlowPixel, neonGlow2D, NEON_GLOW_MAX } from "./neonGlow";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("neonGlowMid", () => {
  it("is 0.5 at size 0 and clamps the size to [-1,1] (so mid ∈ [0.1,0.9])", () => {
    expect(neonGlowMid(0)).toBe(0.5);
    expect(neonGlowMid(1)).toBeCloseTo(0.9, 6); // 0.5 + 0.4·1
    expect(neonGlowMid(-1)).toBeCloseTo(0.1, 6); // 0.5 − 0.4
    expect(neonGlowMid(2)).toBe(neonGlowMid(1)); // size clamped to 1
    expect(neonGlowMid(-5)).toBe(neonGlowMid(-1)); // size clamped to −1
    expect(neonGlowMid(0.6)).toBeCloseTo(0.74, 5);
    expect(neonGlowMid(-0.4)).toBeCloseTo(0.34, 5);
  });
});

describe("neonGlowPixel", () => {
  it("maps black → 0 and white → 65535 regardless of the glow colour", () => {
    for (const gc of [0, 128, 200, 255]) {
      expect(neonGlowPixel(0, 0, 1, gc)).toBe(0);
      expect(neonGlowPixel(NEON_GLOW_MAX, 0, 1, gc)).toBe(NEON_GLOW_MAX);
    }
  });

  it("the two ramps meet at mid: a pixel whose luminance ≈ mid becomes the glow colour", () => {
    // glow 128, brightness 1 ⇒ g = 128·257 = 32896. v=32768 has luminance ≈ 0.5 = mid (size 0).
    expect(neonGlowPixel(32768, 0, 1, 128)).toBe(32896);
  });

  it("shadows ramp below the glow colour, highlights ramp above it", () => {
    const g = 32896; // glow 128 · brightness 1
    expect(neonGlowPixel(10000, 0, 1, 128)).toBeLessThan(g); // l < mid → shadow ramp
    expect(neonGlowPixel(50000, 0, 1, 128)).toBeGreaterThan(g); // l > mid → highlight ramp
  });

  it("pins the aggregate f32-vs-f64 path (v=1275 → 1280, an all-f64 mirror gives 1279)", () => {
    expect(neonGlowPixel(1275, 0, 1, 128)).toBe(1280);
  });

  // Engine-captured probes that sit on the ±1 truncation boundary each individual Math.fround
  // controls: together they make every LIVE per-sub-op fround load-bearing (dropping any one of
  // them flips at least one of these). Captured from the real engine, NOT hand-computed.
  it.each([
    { v: 30258, gs: 0, gb: 0.3, gc: 128, out: 9113 }, // luminance sum / brightness / glow·br / shadow mul / blend
    { v: 22536, gs: -0.4, gb: 0, gc: 0, out: 385 }, // mid (0.5 + 0.4·size) frounds
    { v: 33405, gs: 0, gb: 0, gc: 0, out: 1274 }, // luminance B-term / sum / ÷65535
    { v: 14766, gs: -1, gb: 0, gc: 0, out: 9124 }, // luminance R-term / highlight (L−mid)/(1−mid)
    { v: 50494, gs: 0, gb: 0.3, gc: 64, out: 37718 }, // highlight (65535−g)·frac
    { v: 21843, gs: 0.6, gb: 0.3, gc: 128, out: 4444 }, // shadow L/mid
    { v: 6792, gs: -1, gb: 0, gc: 0, out: 265 }, // highlight 1/(1−mid)
    { v: 32861, gs: 0, gb: 0.3, gc: 200, out: 15563 }, // highlight g + …
  ])("matches the engine on the fround-cover probe v=$v (gs=$gs gb=$gb gc=$gc)", ({ v, gs, gb, gc, out }) => {
    expect(neonGlowPixel(v, gs, gb, gc)).toBe(out);
  });

  it("brightness 0 blacks out the glow colour (shadows → 0, highlights ramp 0→white)", () => {
    expect(neonGlowPixel(10000, 0, 0, 128)).toBe(0); // g=0 ⇒ shadow out 0
    expect(neonGlowPixel(60000, 0, 0, 128)).toBeGreaterThan(0); // highlight ramps 0→white
  });
});

describe("neonGlow2D", () => {
  const g = grid(8, 8, (x, y) => (x * 9973 + y * 9931) % NEON_GLOW_MAX);

  it("keeps every output an integer within [0, 65535]", () => {
    for (const [gs, gb, gc] of [
      [0, 1, 128],
      [0.6, 0.8, 255],
      [-1, 0.3, 64],
    ]) {
      for (const v of flat(neonGlow2D(g, gs, gb, gc))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(NEON_GLOW_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(neonGlow2D([], 0, 1, 128)).toEqual([]);
    expect(neonGlow2D([[], []], 0, 1, 128)).toEqual([[], []]);
    expect(neonGlow2D([[0]], 0, 1, 128)).toEqual([[0]]); // black → 0
    expect(neonGlow2D(g, 0.6, 0.8, 255)).toEqual(neonGlow2D(g, 0.6, 0.8, 255));
  });

  it("does not mutate the input", () => {
    const snapshot = g.map((r) => [...r]);
    neonGlow2D(g, 0.6, 0.8, 200);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const ng = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = neonGlow2D(ng, 0, 1, 128);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's neon_glow on an
//    8×8 grey pattern v = (x·9973 + y·9931) mod 65535. Cases sweep size/brightness and the glow
//    grey colour; the gradient exercises both the shadow and the highlight ramp. Fully bit-exact
//    (no trig/sqrt). ──
describe("engine golden (neon_glow, 8×8 grey)", () => {
  const g = grid(8, 8, (x, y) => (x * 9973 + y * 9931) % NEON_GLOW_MAX);
  const rows = (vals: number[]): number[][] => Array.from({ length: 8 }, (_, y) => vals.slice(y * 8, y * 8 + 8));

  it("matches the engine bit-exactly — size 0, brightness 1, glow 128", () => {
    expect(neonGlow2D(g, 0, 1, 128)).toEqual(
      rows([
        0, 10012, 20024, 30036, 39992, 49926, 59860, 4292, 9969, 19982, 29994, 39950, 49884, 59818, 4250, 14262, 19939,
        29951, 39908, 49842, 59776, 4208, 14220, 24232, 29909, 39867, 49800, 59734, 4166, 14178, 24190, 34192, 39825,
        49759, 59692, 4124, 14136, 24148, 34150, 44084, 49717, 59651, 4081, 14094, 24106, 34108, 44042, 53976, 59609,
        4039, 14051, 24064, 34066, 44000, 53934, 63868, 3997, 14009, 24021, 34025, 43958, 53892, 63826, 8290,
      ]),
    );
  });

  it("matches the engine bit-exactly — size 0.6, brightness 0.8, glow 255", () => {
    expect(neonGlow2D(g, 0.6, 0.8, 255)).toEqual(
      rows([
        0, 10781, 21563, 32344, 43126, 53481, 61152, 4622, 10736, 21517, 32299, 43081, 53448, 61120, 4577, 15358, 21472,
        32254, 43035, 53416, 61088, 4531, 15313, 26095, 32208, 42990, 53384, 61055, 4486, 15268, 26049, 36831, 42944,
        53351, 61023, 4441, 15222, 26004, 36785, 47567, 53319, 60991, 4395, 15177, 25958, 36740, 47522, 56608, 60958,
        4350, 15131, 25913, 36695, 47476, 56576, 64248, 4304, 15086, 25868, 36649, 47431, 56544, 64215, 8927,
      ]),
    );
  });

  it("matches the engine bit-exactly — size −0.4, brightness 0.5, glow 200", () => {
    expect(neonGlow2D(g, -0.4, 0.5, 200)).toEqual(
      rows([
        0, 11502, 23005, 32733, 41918, 51103, 60288, 4931, 11454, 22957, 32694, 41879, 51064, 60249, 4883, 16386, 22908,
        32656, 41841, 51025, 60210, 4835, 16337, 27409, 32617, 41802, 50987, 60172, 4786, 16289, 27370, 36555, 41763,
        50948, 60133, 4738, 16241, 27332, 36516, 45701, 50909, 60094, 4689, 16192, 27293, 36478, 45663, 54848, 60056,
        4641, 16144, 27254, 36439, 45624, 54809, 63994, 4592, 16095, 27216, 36400, 45585, 54770, 63955, 9524,
      ]),
    );
  });
});
