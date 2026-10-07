// Unit tests for the Photocopy filter. Engine-free (node), single luminance-channel model
// (exact for grey R=G=B input). These pin the contrast threshold (0.5/max(darkness,0.1)), the
// local-average luminance, the `avg − lc > thr` ink decision, and the dark-detail→fg /
// else→bg mapping with the ·257 widening (must match filters.rs photocopy), plus cross-
// implementation goldens captured from the Rust engine (both exercising fg AND bg).
import { describe, it, expect } from "vitest";
import { photocopyThreshold, photocopyPixel, photocopy2D, PHOTOCOPY_MAX } from "./photocopy";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("photocopyThreshold", () => {
  it("is 0.5 / max(darkness, 0.1) — higher darkness lowers the threshold", () => {
    expect(photocopyThreshold(1)).toBe(0.5);
    expect(photocopyThreshold(2)).toBe(0.25);
    expect(photocopyThreshold(4)).toBe(0.125);
    expect(photocopyThreshold(0.5)).toBe(1);
  });
  it("clamps darkness up to 0.1", () => {
    expect(photocopyThreshold(0.05)).toBeCloseTo(5, 4); // 0.5 / 0.1
    expect(photocopyThreshold(0)).toBeCloseTo(5, 4);
  });
});

describe("photocopyPixel", () => {
  it("inks a dark detail (foreground) and leaves flat light areas background", () => {
    // a lone dark pixel in a light field: its local average is far brighter than itself
    // (avg − lc ≫ thr) → foreground; a light pixel away from it has avg ≈ lc → background.
    const g = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 1000 : 50000));
    expect(photocopyPixel(g, 3, 3, 1, 1, 0, 255)).toBe(0); // dark spot → fg (0·257)
    expect(photocopyPixel(g, 0, 0, 1, 1, 0, 255)).toBe(65535); // flat light corner → bg
  });

  it("widens the 8-bit fg/bg to 16-bit via ·257", () => {
    const g = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 1000 : 50000));
    expect(photocopyPixel(g, 3, 3, 1, 1, 50, 200)).toBe(50 * 257); // fg = 12850
    expect(photocopyPixel(g, 0, 0, 1, 1, 50, 200)).toBe(200 * 257); // bg = 51400
  });

  it("a higher darkness (lower threshold) inks a marginal detail that a lower one leaves bg", () => {
    // a mild dark dot (35000 in a 50000 field): contrast ≈ 0.21 — inked only when thr < 0.21,
    // i.e. darkness > ~2.4. So darkness 1 (thr 0.5) → bg, darkness 4 (thr 0.125) → fg.
    const g = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 35000 : 50000));
    expect(photocopyPixel(g, 3, 3, 1, 1, 0, 255)).toBe(65535); // thr 0.5 → not inked
    expect(photocopyPixel(g, 3, 3, 1, 4, 0, 255)).toBe(0); // thr 0.125 → inked
  });

  it("a pixel whose contrast EXACTLY equals the threshold stays background (strict >, not >=)", () => {
    // a centre-0 in an 8×1 ring: fr(avg − lc) === thr === 0.000013563574611907825 exactly when
    // darkness = 36863.4375, so the strict gate `avg−lc > thr` is false → bg; a `>=` mutant
    // would ink it fg. (Such exact-equality needs a contrived darkness — grey-integer contrast
    // never lands on thr at "nice" darkness values.)
    const g = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ];
    expect(photocopyPixel(g, 1, 1, 1, 36863.4375, 0, 255)).toBe(65535); // boundary → bg
  });

  it("treats detail < 1 as detail 1 (the max(detail,1) window floor)", () => {
    // a 35000 dot in a 50000 field is inked at darkness 4. With detail 0 the floor keeps r=1
    // (3×3 window) so it still inks (fg); dropping the floor would give r=0 (centre only) →
    // avg==lc → contrast 0 → never inked (bg).
    const g = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 35000 : 50000));
    expect(photocopyPixel(g, 3, 3, 0, 4, 0, 255)).toBe(0); // detail 0 ≡ detail 1 → fg
    expect(photocopyPixel(g, 3, 3, 0, 4, 0, 255)).toBe(photocopyPixel(g, 3, 3, 1, 4, 0, 255));
  });

  it("never inks inside a flat region (avg − lc = 0 is not > thr)", () => {
    const g = grid(5, 5, () => 30000);
    for (const [x, y] of [
      [2, 2],
      [0, 0],
    ]) {
      expect(photocopyPixel(g, x, y, 2, 1, 0, 255)).toBe(65535); // bg
    }
  });
});

describe("photocopy2D", () => {
  it("renders a flat field entirely background", () => {
    expect(photocopy2D(grid(8, 8, () => 30000), 2, 1, 0, 255)).toEqual(grid(8, 8, () => 65535));
  });

  it("emits only the two tones (fg·257 and bg·257)", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % PHOTOCOPY_MAX);
    for (const [fg, bg] of [
      [0, 255],
      [50, 200],
    ]) {
      const tones = [fg * 257, bg * 257];
      for (const v of flat(photocopy2D(g, 2, 3, fg, bg))) expect(tones).toContain(v);
    }
  });

  it("inks only the dark spots of a light field with scattered dark pixels", () => {
    const g = grid(9, 9, (x, y) => ((x + y) % 4 === 0 ? 2000 : 55000));
    const out = photocopy2D(g, 1, 2, 0, 255);
    let inked = 0;
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (out[y][x] === 0) inked++;
    expect(inked).toBeGreaterThan(0); // some dark detail inked
    expect(inked).toBeLessThan(81); // but not everything
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % PHOTOCOPY_MAX);
    for (const [detail, darkness] of [
      [1, 1],
      [2, 4],
      [3, 0.5],
    ]) {
      for (const v of flat(photocopy2D(g, detail, darkness, 0, 255))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(PHOTOCOPY_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(photocopy2D([], 2, 1, 0, 255)).toEqual([]);
    expect(photocopy2D([[], []], 2, 1, 0, 255)).toEqual([[], []]);
    expect(photocopy2D([[40000]], 2, 1, 0, 255)).toEqual([[65535]]); // lone pixel: avg=lc → bg
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(photocopy2D(g, 3, 2, 50, 200)).toEqual(photocopy2D(g, 3, 2, 50, 200));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % PHOTOCOPY_MAX);
    const snapshot = g.map((r) => [...r]);
    photocopy2D(g, 2, 2, 0, 255);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = photocopy2D(g, 2, 2, 0, 255);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's photocopy
//    on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. Both cases produce a MIX of fg and
//    bg (12 inked of 49) — so the ink decision is genuinely exercised, not saturated. ──
describe("engine golden (photocopy, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % PHOTOCOPY_MAX);

  it("matches the engine bit-exactly — detail 2, darkness 4, black/white", () => {
    expect(photocopy2D(input, 2, 4, 0, 255)).toEqual([
      [0, 65535, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 65535, 65535, 0],
      [65535, 65535, 65535, 65535, 65535, 0, 0],
      [65535, 65535, 65535, 65535, 0, 0, 65535],
      [65535, 65535, 65535, 0, 0, 65535, 65535],
      [65535, 65535, 0, 0, 65535, 65535, 65535],
      [65535, 0, 0, 65535, 65535, 65535, 65535],
    ]);
  });

  it("matches the engine bit-exactly — detail 3, darkness 2, grey fg/bg (·257)", () => {
    expect(photocopy2D(input, 3, 2, 50, 200)).toEqual([
      [12850, 51400, 51400, 51400, 51400, 51400, 51400],
      [51400, 51400, 51400, 51400, 51400, 51400, 12850],
      [51400, 51400, 51400, 51400, 51400, 12850, 12850],
      [51400, 51400, 51400, 51400, 12850, 12850, 51400],
      [51400, 51400, 51400, 12850, 12850, 51400, 51400],
      [51400, 51400, 12850, 12850, 51400, 51400, 51400],
      [51400, 12850, 12850, 51400, 51400, 51400, 51400],
    ]);
  });
});

// ── Several detail/darkness/colour fixtures swept for two-tone, shape, flat→bg ──
const FIXTURES: { name: string; detail: number; darkness: number; fg: number; bg: number }[] = [
  { name: "fine high-darkness", detail: 1, darkness: 5, fg: 0, bg: 255 },
  { name: "coarse mid", detail: 4, darkness: 2, fg: 30, bg: 220 },
  { name: "low darkness", detail: 2, darkness: 0.5, fg: 10, bg: 245 },
];

describe.each(FIXTURES)("fixture: $name", ({ detail, darkness, fg, bg }) => {
  it("stays in range, keeps shape, emits two tones, and renders a flat field as bg", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % PHOTOCOPY_MAX);
    const out = photocopy2D(g, detail, darkness, fg, bg);
    const tones = [fg * 257, bg * 257];
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(tones).toContain(v);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(PHOTOCOPY_MAX);
    }
    expect(photocopy2D(grid(13, 13, () => 33333), detail, darkness, fg, bg)).toEqual(
      grid(13, 13, () => bg * 257),
    );
  });
});
