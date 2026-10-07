// Unit tests for the Radial Blur filter. Engine-free (node). These pin the Spin/Zoom
// geometry (must match mod.rs radial_blur_buf) via its defining invariants:
// Spin preserves each sample's radius and sweeps the angle (a rotation), Zoom keeps each
// sample on the centre→pixel ray and scales the radius. The source coords are edge-clamped,
// so a constant image is invariant at any amount (no black creeps in from off-edge), and
// Zoom at amount 0 is the exact identity. The Blur Center (ccx/ccy) and the Draft/Good/
// Best sample count (quality) are engine parameters the dialog exposes, so they are
// covered here too (#149) — the default centre/quality cases alone could not see them.
import { describe, it, expect } from "vitest";
import { radialSamples, radialBlur2D, radialSteps, RADIAL_MAX } from "./radialBlur";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const hyp = Math.hypot;

describe("radialSamples", () => {
  const W = 13;
  const H = 13;
  const cx = W / 2; // 6.5
  const cy = H / 2;

  it("returns 16 samples at the default (Good) quality", () => {
    expect(radialSamples(3, 5, W, H, 80, false)).toHaveLength(16);
    expect(radialSamples(3, 5, W, H, 80, true)).toHaveLength(16);
  });

  it("takes the sample count from quality: 8 Draft / 32 Best / 16 otherwise (#149)", () => {
    expect([radialSteps(0), radialSteps(1), radialSteps(2), radialSteps(7)]).toEqual([8, 16, 32, 16]);
    for (const zoom of [false, true]) {
      expect(radialSamples(3, 5, W, H, 80, zoom, 0.5, 0.5, 0)).toHaveLength(8);
      expect(radialSamples(3, 5, W, H, 80, zoom, 0.5, 0.5, 2)).toHaveLength(32);
    }
  });

  it("the t = k/(steps−1) − 0.5 sweep still spans ±0.5 at Draft/Best (only density changes)", () => {
    // An off-by-one in `steps` would move the endpoints; this pins them across all three.
    const good = radialSamples(8, 7, W, H, 80, false);
    for (const q of [0, 2]) {
      const s = radialSamples(8, 7, W, H, 80, false, 0.5, 0.5, q);
      expect(s[0]).toEqual(good[0]);
      expect(s[s.length - 1]).toEqual(good[good.length - 1]);
    }
  });

  it("Zoom rays radiate from the ccx/ccy Blur Center, not the image centre (#149)", () => {
    const [ccx, ccy] = [0.25, 0.75];
    const bx = W * ccx;
    const by = H * ccy;
    const [x, y] = [8, 7]; // ray stays inside the image at amount 60 (no clamp)
    const dx = x + 0.5 - bx;
    const dy = y + 0.5 - by;
    const s = radialSamples(x, y, W, H, 60, true, ccx, ccy);
    for (const { fx, fy } of s) {
      // collinear with the OFF-CENTRE radius — a mirror pinned to w/2 fails here
      expect((fx + 0.5 - bx) * dy - (fy + 0.5 - by) * dx).toBeCloseTo(0, 2);
    }
    expect(s).not.toEqual(radialSamples(x, y, W, H, 60, true));
  });

  it("Spin about an off-centre Blur Center preserves the radius measured from THAT centre", () => {
    const [ccx, ccy] = [0.25, 0.75];
    const bx = W * ccx;
    const by = H * ccy;
    const [x, y] = [8, 7];
    const r = hyp(x + 0.5 - bx, y + 0.5 - by);
    for (const { fx, fy } of radialSamples(x, y, W, H, 40, false, ccx, ccy)) {
      expect(hyp(fx + 0.5 - bx, fy + 0.5 - by)).toBeCloseTo(r, 2);
    }
  });

  it("Zoom at amount 0 collapses every sample exactly onto the pixel (no trig)", () => {
    for (const [x, y] of [
      [3, 5],
      [9, 8],
      [0, 12],
    ]) {
      for (const { fx, fy } of radialSamples(x, y, W, H, 0, true)) {
        expect(fx).toBe(x); // s ≡ 1 → src = (x+0.5,y+0.5) → clamp(x) exactly
        expect(fy).toBe(y);
      }
    }
  });

  it("copies the centre pixel onto itself for both methods (odd dims)", () => {
    // pixel (6,6) sits at cx=cy=6.5 → dx=dy=0 → r=0 → every sample is (6,6)
    for (const zoom of [false, true]) {
      for (const { fx, fy } of radialSamples(6, 6, W, H, 90, zoom)) {
        expect(fx).toBe(6);
        expect(fy).toBe(6);
      }
    }
  });

  it("Spin preserves each sample's radius and sweeps the angle (a rotation)", () => {
    const [x, y] = [8, 7]; // dx=2, dy=1, r=√5 — arc stays inside the image (no clamp)
    const r = hyp(x + 0.5 - cx, y + 0.5 - cy);
    const s = radialSamples(x, y, W, H, 80, false); // maxAng = 0.8·0.8 = 0.64 rad
    for (const { fx, fy } of s) {
      expect(hyp(fx + 0.5 - cx, fy + 0.5 - cy)).toBeCloseTo(r, 2); // radius unchanged
    }
    const angOf = (p: { fx: number; fy: number }) =>
      Math.atan2(p.fy + 0.5 - cy, p.fx + 0.5 - cx);
    expect(angOf(s[15]) - angOf(s[0])).toBeCloseTo(0.64, 2); // full angular sweep = maxAng
  });

  it("Zoom keeps every sample on the centre→pixel ray and scales the radius", () => {
    const [x, y] = [10, 9]; // dx=4, dy=3, r=5 — ray stays inside the image (no clamp)
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const r = hyp(dx, dy);
    const s = radialSamples(x, y, W, H, 80, true); // maxScl = 0.8·1.2 = 0.96
    for (const { fx, fy } of s) {
      const cross = (fx + 0.5 - cx) * dy - (fy + 0.5 - cy) * dx;
      expect(cross).toBeCloseTo(0, 2); // collinear with the radius → no angular twist
    }
    const radii = s.map(({ fx, fy }) => hyp(fx + 0.5 - cx, fy + 0.5 - cy));
    // s spans 1±0.48 → radius spans r·[0.52, 1.48]
    expect(Math.min(...radii)).toBeCloseTo(r * 0.52, 2);
    expect(Math.max(...radii)).toBeCloseTo(r * 1.48, 2);
  });

  it("is symmetric about the pixel — the mid samples straddle it (Zoom)", () => {
    // t goes −0.5…+0.5, so samples 7 and 8 are the two closest to t=0 (the pixel itself)
    const [x, y] = [10, 9];
    const s = radialSamples(x, y, W, H, 60, true);
    const r = hyp(x + 0.5 - cx, y + 0.5 - cy);
    const r7 = hyp(s[7].fx + 0.5 - cx, s[7].fy + 0.5 - cy);
    const r8 = hyp(s[8].fx + 0.5 - cx, s[8].fy + 0.5 - cy);
    expect(r7).toBeLessThan(r); // just inside
    expect(r8).toBeGreaterThan(r); // just outside
  });

  it("pins the Spin base angle θ = atan2(dy, dx) across all four quadrants", () => {
    // The t≈0 samples (k=7,8 straddle the pixel) average back to the source pixel ONLY when
    // θ uses the correct atan2 arg order; an atan2-arg or cos/sin swap reflects the midpoint
    // across the diagonal (e.g. (8,7)→≈(7,8)) and fails. This is the assertion that anchors
    // *where* the spin arc sits, independent of the radius/sweep invariants above.
    for (const [x, y] of [
      [8, 7], // dx>0, dy>0
      [5, 8], // dx<0, dy>0
      [9, 4], // dx>0, dy<0
      [4, 3], // dx<0, dy<0
    ]) {
      const s = radialSamples(x, y, W, H, 80, false);
      const midX = (s[7].fx + s[8].fx) / 2;
      const midY = (s[7].fy + s[8].fy) / 2;
      expect(midX).toBeCloseTo(x, 2);
      expect(midY).toBeCloseTo(y, 2);
    }
  });

  it("truncates a fractional amount like the engine's u32 cast", () => {
    for (const zoom of [false, true]) {
      expect(radialSamples(3, 5, W, H, 80.9, zoom)).toEqual(radialSamples(3, 5, W, H, 80, zoom));
      expect(radialSamples(9, 2, W, H, 100.4, zoom)).toEqual(radialSamples(9, 2, W, H, 100, zoom));
    }
  });

  it("edge-clamps a Zoom ray that runs off the image (replicate, never out of range)", () => {
    // a corner pixel at a big amount pushes the outer samples past the border
    const s = radialSamples(12, 12, W, H, 100, true);
    for (const { fx, fy } of s) {
      expect(fx).toBeGreaterThanOrEqual(0);
      expect(fx).toBeLessThanOrEqual(W - 1);
      expect(fy).toBeGreaterThanOrEqual(0);
      expect(fy).toBeLessThanOrEqual(H - 1);
    }
  });
});

describe("radialBlur2D", () => {
  it("leaves a constant image exactly unchanged at any amount (edge-replicate, no black)", () => {
    // THE distinguishing property vs the Distort family: clamped samples replicate the
    // border, so every tap returns the constant — no 0 ever leaks in from off-edge.
    const g = grid(13, 13, () => 30000);
    for (const zoom of [false, true]) {
      for (const amount of [0, 40, 100]) {
        expect(radialBlur2D(g, amount, zoom)).toEqual(g);
        // …at any Blur Center and any quality, too
        expect(radialBlur2D(g, amount, zoom, 0.2, 0.8, 0)).toEqual(g);
        expect(radialBlur2D(g, amount, zoom, 0.9, 0.1, 2)).toEqual(g);
      }
    }
  });

  it("averages `radialSteps(quality)` taps and honours the Blur Center (#149)", () => {
    const g = grid(13, 13, (x, y) => (x * 37 + y * 19) % RADIAL_MAX);
    for (const zoom of [false, true]) {
      // Draft (8) and Best (32) are genuinely different renders from Good (16)…
      expect(radialBlur2D(g, 70, zoom, 0.5, 0.5, 0)).not.toEqual(radialBlur2D(g, 70, zoom));
      expect(radialBlur2D(g, 70, zoom, 0.5, 0.5, 2)).not.toEqual(radialBlur2D(g, 70, zoom));
      // …and so is the same blur about an off-centre origin
      expect(radialBlur2D(g, 70, zoom, 0.25, 0.75)).not.toEqual(radialBlur2D(g, 70, zoom));
    }
    // Zoom at amount 0 stays the exact identity wherever the centre is (s ≡ 1)
    expect(radialBlur2D(g, 0, true, 0.25, 0.75, 2)).toEqual(g);
  });

  it("Zoom at amount 0 is the exact identity on a textured image (no trig round-trip)", () => {
    const g = grid(13, 13, (x, y) => (x * 37 + y * 19) % RADIAL_MAX);
    expect(radialBlur2D(g, 0, true)).toEqual(g);
  });

  it("Spin at amount 0 is the identity to within a couple of LSB (trig round-trip)", () => {
    const g = grid(13, 13, (x, y) => (x * 37 + y * 19) % RADIAL_MAX);
    const out = radialBlur2D(g, 0, false);
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) {
        expect(Math.abs(out[y][x] - g[y][x])).toBeLessThanOrEqual(2);
      }
    }
  });

  it("copies the dead-centre pixel unchanged at any amount/method (odd dims)", () => {
    const g = grid(13, 13, (x, y) => (x * 53 + y * 97) % RADIAL_MAX);
    for (const zoom of [false, true]) {
      expect(radialBlur2D(g, 90, zoom)[6][6]).toBe(g[6][6]);
    }
  });

  it("actually blurs (changes) the interior at a non-zero amount, both methods", () => {
    const g = grid(13, 13, (x, y) => (x + y) * 2000);
    expect(radialBlur2D(g, 80, false)).not.toEqual(g);
    expect(radialBlur2D(g, 80, true)).not.toEqual(g);
  });

  it("Spin and Zoom give different results on a textured image", () => {
    const g = grid(13, 13, (x, y) => (x * 17 + y * 31) % RADIAL_MAX);
    expect(radialBlur2D(g, 70, false)).not.toEqual(radialBlur2D(g, 70, true));
  });

  it("a larger amount blurs more (differs from a smaller amount)", () => {
    const g = grid(13, 13, (x, y) => (x * 6151 + y * 3079) % RADIAL_MAX);
    expect(radialBlur2D(g, 20, true)).not.toEqual(radialBlur2D(g, 100, true));
  });

  it("keeps every output an integer within [0, 65535] for both methods", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % RADIAL_MAX);
    for (const zoom of [false, true]) {
      for (const v of flat(radialBlur2D(g, 100, zoom))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(RADIAL_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(radialBlur2D([], 50, false)).toEqual([]);
    expect(radialBlur2D([[], []], 50, true)).toEqual([[], []]);
    expect(radialBlur2D([[42]], 90, false)).toEqual([[42]]); // lone pixel is its own centre
    expect(radialBlur2D([[42]], 90, true)).toEqual([[42]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(radialBlur2D(g, 60, true)).toEqual(radialBlur2D(g, 60, true));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    for (const zoom of [false, true]) radialBlur2D(g, 80, zoom);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = radialBlur2D(g, 60, false);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's
//    radial_blur_buf (7×7, amount 80) on the input (x·9973 + y·9931) mod 65535. This pins
//    the WHOLE pipeline (geometry + bilinear + 16-tap average + round) to bit-exactness on
//    the trig-free Zoom path and to the documented f32-trig residual on Spin. ──
describe("engine golden (radial_blur_buf, 7×7, amount 80)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % RADIAL_MAX);
  // Spin (zoom=false)
  const GOLDEN_SPIN = [
    [5621, 12322, 21264, 30492, 40826, 43352, 41713],
    [12286, 20670, 30451, 40232, 47104, 42508, 22871],
    [21184, 30410, 40191, 49814, 49893, 18336, 18145],
    [30368, 40150, 49772, 59712, 10440, 14374, 23521],
    [40664, 46980, 49810, 10399, 13698, 23479, 32705],
    [43152, 42343, 18212, 14291, 23438, 33219, 41603],
    [41485, 22671, 17982, 23397, 32625, 41567, 48268],
  ];
  // Zoom (zoom=true)
  const GOLDEN_ZOOM = [
    [7643, 13787, 23760, 33733, 43706, 53368, 54231],
    [13761, 19904, 29877, 39850, 49823, 49059, 27660],
    [23692, 29835, 39808, 49781, 48681, 17949, 12014],
    [33623, 39766, 49739, 59712, 12539, 14123, 20266],
    [43554, 49697, 48597, 12497, 16933, 24054, 30197],
    [53174, 48891, 17823, 14039, 24012, 33985, 40128],
    [54011, 27467, 11863, 20157, 30129, 40102, 46246],
  ];

  it("matches the engine bit-exactly on the trig-free Zoom path", () => {
    expect(radialBlur2D(input, 80, true)).toEqual(GOLDEN_ZOOM);
  });

  it("matches the engine on the Spin path to within 1 LSB (f32 cos/sin/atan2 residual)", () => {
    const out = radialBlur2D(input, 80, false);
    let maxDiff = 0;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        maxDiff = Math.max(maxDiff, Math.abs(out[y][x] - GOLDEN_SPIN[y][x]));
      }
    }
    expect(maxDiff).toBeLessThanOrEqual(1);
  });
});

// ── Several amount/method/image fixtures swept for in-range, shape, constant-invariance ──
const FIXTURES: { name: string; amount: number; zoom: boolean }[] = [
  { name: "gentle spin", amount: 25, zoom: false },
  { name: "strong spin", amount: 100, zoom: false },
  { name: "gentle zoom", amount: 25, zoom: true },
  { name: "strong zoom", amount: 100, zoom: true },
];

describe.each(FIXTURES)("fixture: $name", ({ amount, zoom }) => {
  it("stays in range, keeps shape, and leaves a flat field untouched", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % RADIAL_MAX);
    const out = radialBlur2D(g, amount, zoom);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RADIAL_MAX);
    }
    // a uniform field is invariant (edge-replicate averaging of equal values)
    const flatField = grid(13, 13, () => 12345);
    expect(radialBlur2D(flatField, amount, zoom)).toEqual(flatField);
  });
});
