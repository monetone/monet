// Unit tests for the Twirl distortion. Engine-free (node). These pin the bilinear sampler
// (must match mod.rs sample_bi: 4 edge-clamped taps blended by the fractional position,
// round-to-nearest, far-out-of-bounds → 0) and the twirl warp (mod.rs twirl_buf): angle 0
// and the region outside the radius are the exact identity, a rotation preserves distance
// from the centre, and a constant image is invariant.
import { describe, it, expect } from "vitest";
import {
  sampleBilinear,
  twirlSource,
  twirl2D,
  packTwirlParams,
  unpackTwirlParams,
  TWIRL_MAX,
} from "./twirl";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("sampleBilinear", () => {
  const img = [
    [0, 100, 200],
    [40, 80, 120],
    [10, 50, 90],
  ];

  it("returns the exact pixel at integer coordinates", () => {
    expect(sampleBilinear(img, 0, 0)).toBe(0);
    expect(sampleBilinear(img, 2, 1)).toBe(120);
    expect(sampleBilinear(img, 1, 2)).toBe(50);
  });

  it("averages horizontally and vertically at midpoints", () => {
    expect(sampleBilinear([[0, 100]], 0.5, 0)).toBe(50); // (0+100)/2
    expect(sampleBilinear([[0], [100]], 0, 0.5)).toBe(50);
    expect(sampleBilinear([[0, 100], [200, 40]], 0.5, 0.5)).toBe(85); // (0+100+200+40)/4
  });

  it("rounds the blended value to the nearest 16-bit integer", () => {
    expect(sampleBilinear([[0, 100]], 0.25, 0)).toBe(25); // 0·0.75 + 100·0.25
    expect(sampleBilinear([[0, 101]], 0.5, 0)).toBe(51); // 50.5 → 51 (round half up)
  });

  it("returns 0 far outside the image, but edge-clamps within the ±1 border", () => {
    const w = 3;
    expect(sampleBilinear(img, -1.5, 1)).toBe(0); // fx < −1 → transparent
    expect(sampleBilinear(img, w + 0.5, 1)).toBe(0); // fx > w → transparent
    expect(sampleBilinear(img, -1, 1)).toBe(img[1][0]); // fx == −1 → clamped, tx 0
    expect(sampleBilinear(img, w, 1)).toBe(img[1][2]); // fx == w → clamped to col 2
  });

  it("edge-clamps the far tap at the right/bottom border", () => {
    // at (1.5, 0) the right tap (col 2) and (1,0)=100,(2,0)=200 blend
    expect(sampleBilinear([[100, 200, 50]], 1.5, 0)).toBe(125); // (200+50)/2
  });

  it("applies the same bounds/clamp rules on the vertical (fy) axis", () => {
    const h = 3;
    expect(sampleBilinear(img, 1, -1.5)).toBe(0); // fy < −1 → transparent
    expect(sampleBilinear(img, 1, h + 0.5)).toBe(0); // fy > h → transparent
    expect(sampleBilinear(img, 1, -1)).toBe(img[0][1]); // fy == −1 → clamped to row 0
    expect(sampleBilinear(img, 1, h)).toBe(img[2][1]); // fy == h → clamped to row 2
  });
});

describe("twirlSource", () => {
  it("angle 0 maps every pixel to itself exactly", () => {
    for (const [x, y] of [
      [0, 0],
      [3, 4],
      [9, 9],
      [5, 2],
    ]) {
      const { fx, fy } = twirlSource(x, y, 10, 10, 0);
      expect(fx).toBe(x);
      expect(fy).toBe(y);
    }
  });

  it("leaves pixels outside the radius unwarped (t = 0)", () => {
    // corner of a 10×10: dist ≈ 6.36 > r = 5 → t = 0 → identity
    const { fx, fy } = twirlSource(0, 0, 10, 10, 180);
    expect(fx).toBeCloseTo(0, 5);
    expect(fy).toBeCloseTo(0, 5);
  });

  it("twists in the sign of the angle (a positive angle rotates one way)", () => {
    // pixel (8,5) of an 11×11 sits right of centre (dx>0, dy≈0); the source offset is
    // (dx·cos, dx·sin), so a positive angle (sin>0) pulls the source below centre and a
    // negative angle above — pinning rotation direction (a sign-flip would fail this).
    const cy = 11 / 2;
    expect(twirlSource(8, 5, 11, 11, 90).fy + 0.5 - cy).toBeGreaterThan(0);
    expect(twirlSource(8, 5, 11, 11, -90).fy + 0.5 - cy).toBeLessThan(0);
  });

  it("preserves distance from the centre (a rotation)", () => {
    const w = 11;
    const h = 11;
    const cx = w / 2;
    const cy = h / 2;
    for (const [x, y] of [
      [3, 5],
      [5, 4],
      [6, 7],
      [4, 6],
    ]) {
      const { fx, fy } = twirlSource(x, y, w, h, 150);
      const srcR = Math.hypot(fx + 0.5 - cx, fy + 0.5 - cy);
      const dstR = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      expect(srcR).toBeCloseTo(dstR, 3);
    }
  });
});

describe("twirl2D", () => {
  it("angle 0 is the exact identity", () => {
    const g = grid(8, 8, (x, y) => (x * 31 + y * 17) % TWIRL_MAX);
    expect(twirl2D(g, 0)).toEqual(g);
  });

  it("leaves a constant image unchanged at any angle (bilinear of equals)", () => {
    const g = grid(9, 9, () => 32000);
    for (const angle of [45, 180, 360, -120]) {
      expect(twirl2D(g, angle)).toEqual(g);
    }
  });

  it("leaves the corners (outside the radius) unchanged", () => {
    const g = grid(11, 11, (x, y) => (x * 53 + y * 97) % TWIRL_MAX);
    const out = twirl2D(g, 200);
    // the four corners sit beyond r = 5.5 → identity
    expect(out[0][0]).toBe(g[0][0]);
    expect(out[0][10]).toBe(g[0][10]);
    expect(out[10][0]).toBe(g[10][0]);
    expect(out[10][10]).toBe(g[10][10]);
  });

  it("warps the interior at a non-zero angle (not the identity)", () => {
    const g = grid(11, 11, (x, y) => (x + y) * 2000); // a smooth gradient
    expect(twirl2D(g, 120)).not.toEqual(g);
  });

  it("keeps every output within [0, 65535]", () => {
    const g = grid(10, 12, (x, y) => (x * 6151 + y * 3079) % TWIRL_MAX);
    for (const v of flat(twirl2D(g, 135))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(TWIRL_MAX);
    }
  });

  it("handles an empty image and is deterministic", () => {
    expect(twirl2D([], 90)).toEqual([]);
    expect(twirl2D([[], []], 90)).toEqual([[], []]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(twirl2D(g, 90)).toEqual(twirl2D(g, 90));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    twirl2D(g, 120);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 11, (x, y) => (x * 11 + y * 5) % 50000);
    const out = twirl2D(g, 90);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 11)).toBe(true);
  });

  it("a 1×1 image is the identity (the lone pixel is the centre of rotation)", () => {
    expect(twirl2D([[42]], 137)).toEqual([[42]]);
  });
});

describe("smart-filter params (id 14)", () => {
  it("packs and unpacks [angle], f32-rounded", () => {
    expect(packTwirlParams(90)).toEqual([90]);
    expect(unpackTwirlParams([90])).toBe(90);
    expect(unpackTwirlParams([])).toBe(0);
    expect(unpackTwirlParams([99.9])).toBe(Math.fround(99.9));
  });

  it("round-trips and replays the same warp", () => {
    const g = grid(8, 8, (x, y) => (x * 13 + y * 7) % 60000);
    const angle = unpackTwirlParams(packTwirlParams(135));
    expect(twirl2D(g, angle)).toEqual(twirl2D(g, Math.fround(135)));
  });
});

// ── Several angle/image fixtures swept for identity-at-edges, range, and determinism ──
const FIXTURES: { name: string; angle: number }[] = [
  { name: "gentle 45°", angle: 45 },
  { name: "half turn 180°", angle: 180 },
  { name: "strong 300°", angle: 300 },
  { name: "negative −90°", angle: -90 },
];

describe.each(FIXTURES)("fixture: $name", ({ angle }) => {
  it("stays in range, keeps shape, and leaves the constant region invariant", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % TWIRL_MAX);
    const out = twirl2D(g, angle);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(TWIRL_MAX);
    }
    // a flat image is invariant under any twirl (every bilinear sample equals the constant)
    expect(twirl2D(grid(13, 13, () => 41000), angle).every((r) => r.every((v) => v === 41000))).toBe(true);
  });
});
