// Unit tests for the Emboss filter. Engine-free (node). These pin the directional-relief
// value (must match filters.rs emboss: v = clamp(32768 + (a−b)·amount), b = the neighbour
// max(height, 1) steps along the angle, round-half-away per pixel) and its defining
// behaviour: flats go mid-grey (32768), and edges become light/dark relief depending on
// direction. Height (the engine's third param, #147) is covered alongside angle/amount.
import { describe, it, expect } from "vitest";
import {
  embossDirection,
  embossValue,
  emboss2D,
  packEmbossParams,
  unpackEmbossParams,
  EMBOSS_MID,
  EMBOSS_MAX,
} from "./emboss";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

// An independent per-pixel oracle mirroring filters.rs emboss (re-rounds the neighbour
// per pixel; a precomputed-offset impl would diverge at oblique angles where dx/dy ≈ ±0.5).
const fr = Math.fround;
const DEG2RAD = fr(fr(Math.PI) / 180);
const roundHA = (x: number): number => {
  const r = x < 0 ? -Math.round(-x) : Math.round(x);
  return r === 0 ? 0 : r;
};
const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
const clampU16 = (n: number) => (n < 0 ? 0 : n > EMBOSS_MAX ? EMBOSS_MAX : n);
const oracle = (img: number[][], angle: number, amount: number, height = 1): number[][] => {
  const h = img.length;
  const w = img[0].length;
  const rad = fr(fr(angle) * DEG2RAD);
  const hh = fr(Math.max(fr(height), 1)); // engine `height.max(1.0)`
  const dx = fr(fr(Math.cos(rad)) * hh);
  const dy = fr(fr(Math.sin(rad)) * hh);
  return img.map((_, y) =>
    img[0].map((__, x) => {
      const sx = roundHA(fr(x + dx));
      const sy = roundHA(fr(y + dy));
      const b = img[clamp(sy, h - 1)][clamp(sx, w - 1)];
      return Math.trunc(clampU16(fr(EMBOSS_MID + fr(fr(img[y][x] - b) * fr(amount)))));
    }),
  );
};

describe("embossDirection", () => {
  it("is (cos, sin) of the angle — axis-aligned steps are clean", () => {
    expect(embossDirection(0).dx).toBeCloseTo(1, 6);
    expect(embossDirection(0).dy).toBeCloseTo(0, 6);
    expect(embossDirection(90).dy).toBeCloseTo(1, 6);
    expect(embossDirection(90).dx).toBeCloseTo(0, 6);
    expect(embossDirection(180).dx).toBeCloseTo(-1, 6);
    expect(embossDirection(45).dx).toBeCloseTo(Math.SQRT1_2, 5);
    expect(embossDirection(45).dy).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("scales the step by Height, floored at 1 like the engine's `height.max(1.0)` (#147)", () => {
    expect(embossDirection(0, 5).dx).toBeCloseTo(5, 5);
    expect(embossDirection(90, 5).dy).toBeCloseTo(5, 5);
    expect(embossDirection(45, 4).dx).toBeCloseTo(4 * Math.SQRT1_2, 4);
    // 0 / a sub-1 height still steps one pixel (the engine floors it)
    expect(embossDirection(0, 0)).toEqual(embossDirection(0));
    expect(embossDirection(0, 0.25)).toEqual(embossDirection(0, 1));
  });
});

describe("embossValue", () => {
  it("a flat pair (a = b) is exactly mid-grey", () => {
    for (const v of [0, 100, 32768, 65535]) expect(embossValue(v, v, 3)).toBe(EMBOSS_MID);
  });

  it("amount 0 is always mid-grey regardless of contrast", () => {
    expect(embossValue(65535, 0, 0)).toBe(EMBOSS_MID);
    expect(embossValue(0, 65535, 0)).toBe(EMBOSS_MID);
  });

  it("brightens above mid when the pixel leads its neighbour, darkens below when it trails", () => {
    expect(embossValue(200, 50, 1)).toBe(32918); // 32768 + 150
    expect(embossValue(50, 200, 1)).toBe(32618); // 32768 − 150
    expect(embossValue(200, 50, 2)).toBe(33068); // amount scales the relief
  });

  it("clamps the relief to [0, 65535]", () => {
    expect(embossValue(65535, 0, 5)).toBe(EMBOSS_MAX); // huge positive → white
    expect(embossValue(0, 65535, 5)).toBe(0); // huge negative → black
  });
});

describe("emboss2D", () => {
  it("turns a flat image entirely mid-grey (the defining property)", () => {
    const g = grid(5, 5, () => 40000);
    expect(emboss2D(g, 135, 1).every((row) => row.every((v) => v === EMBOSS_MID))).toBe(true);
  });

  it("amount 0 flattens everything to mid-grey", () => {
    const g = grid(4, 6, (x, y) => (x * 31 + y * 17) % 65535);
    expect(emboss2D(g, 45, 0).every((row) => row.every((v) => v === EMBOSS_MID))).toBe(true);
  });

  it("at 0° the neighbour is the pixel to the right", () => {
    // row [100,200,50]: x0 trails 200 → below mid; x1 leads 50 → above; x2 clamps to self → mid
    expect(emboss2D([[100, 200, 50]], 0, 1)).toEqual([[32668, 32918, 32768]]);
  });

  it("at 90° the neighbour is the pixel below", () => {
    // column [100,200,50]: same relief, vertical
    expect(emboss2D([[100], [200], [50]], 90, 1)).toEqual([[32668], [32918], [32768]]);
  });

  it("at 180° the neighbour is the pixel to the left (reversed relief)", () => {
    expect(emboss2D([[100, 200, 50]], 180, 1)).toEqual([[32768, 32868, 32618]]);
  });

  it("matches an independent per-pixel oracle at oblique angles and amounts", () => {
    const g = grid(8, 8, (x, y) => (x * 4099 + y * 8191) % EMBOSS_MAX);
    // 120/240/−120 have cos≈−0.50000006: `fr(x+dx)` snaps to an i+0.5 tie that rounds the
    // OTHER way than `x + round(dx)` — so these specifically catch a precomputed-offset
    // regression (a flat-offset impl diverges from this oracle there). Others cover spread.
    for (const angle of [30, 45, 120, 135, 150, 210, 240, 315, -45, -120]) {
      for (const amt of [0.5, 1, 2.5]) {
        expect(emboss2D(g, angle, amt)).toEqual(oracle(g, angle, amt));
      }
    }
  });

  it("keeps every output within [0, 65535]", () => {
    const g = grid(7, 9, (x, y) => (x * 6151 + y * 3079) % EMBOSS_MAX);
    for (const v of flat(emboss2D(g, 60, 4))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(EMBOSS_MAX);
    }
  });

  it("handles an empty image and is deterministic", () => {
    expect(emboss2D([], 30, 1)).toEqual([]);
    expect(emboss2D([[], []], 30, 1)).toEqual([[], []]);
    const g = grid(6, 6, (x, y) => (x * 53 + y * 97) % 40000);
    expect(emboss2D(g, 135, 1.5)).toEqual(emboss2D(g, 135, 1.5));
  });

  it("does not mutate the input", () => {
    const g = grid(5, 5, (x, y) => (x + y) * 4000);
    const snapshot = g.map((row) => [...row]);
    emboss2D(g, 45, 2);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(3, 9, (x, y) => (x * 11 + y * 5) % 50000);
    const out = emboss2D(g, 30, 1);
    expect(out.length).toBe(3);
    expect(out.every((row) => row.length === 9)).toBe(true);
  });
});

describe("smart-filter params (id 6)", () => {
  // The dispatcher reads g(0), g(1), g(2) — a 2-float pack made the engine see height 0
  // (→ floored to 1) and replayed every relief at 1px (#147).
  it("packs and unpacks [angle, amount, height] (f32-rounded)", () => {
    expect(packEmbossParams(135, 1, 5)).toEqual([135, 1, 5]);
    expect(packEmbossParams(135, 1)).toEqual([135, 1, 1]); // Height defaults to the engine floor
    expect(unpackEmbossParams([135, 1, 5])).toEqual({ angle: 135, amount: 1, height: 5 });
    // an absent slot 2 reads 1 — what the engine's `height.max(1.0)` makes of g(2) == 0
    expect(unpackEmbossParams([135, 1])).toEqual({ angle: 135, amount: 1, height: 1 });
    expect(unpackEmbossParams([])).toEqual({ angle: 0, amount: 0, height: 1 });
  });

  it("a packed Height survives the round-trip and actually changes the relief", () => {
    const g = grid(9, 9, (x, y) => (x * 5003 + y * 9001) % EMBOSS_MAX);
    const { angle, amount, height } = unpackEmbossParams(packEmbossParams(0, 1, 5));
    expect(height).toBe(5);
    expect(emboss2D(g, angle, amount, height)).toEqual(oracle(g, 0, 1, 5));
    // a 5px relief is not a 1px one — the whole point of threading the param through
    expect(emboss2D(g, angle, amount, height)).not.toEqual(emboss2D(g, angle, amount));
  });

  it("f32-rounds on unpack (a non-f32-exact amount makes the fround observable)", () => {
    // 1.3 is NOT exactly f32-representable, so the unpack must round it like the engine's
    // f32 param — this would fail if `unpackEmbossParams` dropped its `fround`.
    expect(unpackEmbossParams(packEmbossParams(135, 1.3)).amount).toBe(Math.fround(1.3));
    const g = grid(6, 6, (x, y) => (x * 13 + y * 7) % 60000);
    const { angle, amount } = unpackEmbossParams(packEmbossParams(135, 1.3));
    expect(emboss2D(g, angle, amount)).toEqual(emboss2D(g, Math.fround(135), Math.fround(1.3)));
  });
});

// ── Several angle/amount fixtures swept for mid-grey-flat, range, and oracle match ──
const FIXTURES: { name: string; angle: number; amount: number; height?: number }[] = [
  { name: "default 135°", angle: 135, amount: 1 },
  { name: "shallow 30°", angle: 30, amount: 0.5 },
  { name: "strong 90°", angle: 90, amount: 5 },
  { name: "negative angle", angle: -120, amount: 2 },
  { name: "tall relief 135° h=5", angle: 135, amount: 1, height: 5 },
  { name: "tall relief 30° h=3", angle: 30, amount: 0.5, height: 3 },
];

describe.each(FIXTURES)("fixture: $name", ({ angle, amount, height = 1 }) => {
  it("matches the oracle, stays in range, and flats stay mid-grey", () => {
    const g = grid(9, 7, (x, y) => (x * 5003 + y * 9001) % EMBOSS_MAX);
    expect(emboss2D(g, angle, amount, height)).toEqual(oracle(g, angle, amount, height));
    const flatImg = grid(5, 5, () => 33000);
    expect(emboss2D(flatImg, angle, amount, height).every((r) => r.every((v) => v === EMBOSS_MID))).toBe(true);
    for (const v of flat(emboss2D(g, angle, amount, height))) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(EMBOSS_MAX);
    }
  });
});
