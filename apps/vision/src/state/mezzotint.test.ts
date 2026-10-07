// Unit tests for the Mezzotint filter. Engine-free (node), single-channel model. Mezzotint thresholds
// each channel value against a deterministic seeded per-cell hash, forcing it to 0 or 65535 (a 1-bit
// dither). The threshold depends on the channel index, so channels dither independently — this models
// ONE channel (`channel` param); with channel 0 it matches the engine's red channel. These pin the
// hash, the cell selection per kind, and the `val >= hash` threshold (must match filters.rs mezzotint),
// plus engine goldens. The hash is exact integer; the `fr(v/65535) >= hash` compare is f32-sensitive
// and witnessed by the `engine f32-vs-f64 threshold discriminator` goldens.
import { describe, it, expect } from "vitest";
import { mezzotintHash, mezzotintBlock, mezzotint2D, MEZZOTINT_MAX } from "./mezzotint";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const greyHash = (h: number, w: number) => grid(h, w, (x, y) => (x * 9973 + y * 9931) % 65535);
const rows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};

describe("mezzotintHash / mezzotintBlock", () => {
  it("hash is deterministic, in [0,1), and sensitive to each input + seed (concrete pins)", () => {
    expect(mezzotintHash(0, 0, 0, 367)).toBe(0.9995269775390625); // engine-faithful (validated by goldens)
    // isolates the channel constant 0xC2B2AE35: a=b=seed=0 ⇒ v = 1·0xC2B2AE35, so channel-0 goldens
    // (where that term is 0) can't catch a wrong value — this pin + the channel-1 golden below do.
    expect(mezzotintHash(0, 0, 1, 0)).toBe(0.5126800537109375);
    expect(mezzotintHash(1, 2, 0, 42)).not.toBe(mezzotintHash(1, 2, 1, 42)); // channel matters
    expect(mezzotintHash(1, 2, 0, 42)).not.toBe(mezzotintHash(1, 2, 0, 43)); // seed matters
    for (let a = 0; a < 30; a++) for (let b = 0; b < 30; b++) {
      const v = mezzotintHash(a, b, 0, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("block pitch is 1/2/3 for kinds 0/1/2 (and 3 for the line kinds 3/4; any other kind → dots block 3)", () => {
    expect([0, 1, 2, 3, 4].map(mezzotintBlock)).toEqual([1, 2, 3, 3, 3]);
    expect(mezzotintBlock(5)).toBe(3); // engine `_` arm
    // an out-of-range kind falls through to the dots arm at block 3 — identical to kind 2
    expect(mezzotint2D(greyHash(12, 12), 5, 42, 0)).toEqual(mezzotint2D(greyHash(12, 12), 2, 42, 0));
  });
});

describe("mezzotint2D", () => {
  const img = greyHash(12, 12);

  it("emits only pure black (0) or white (65535)", () => {
    for (const kind of [0, 1, 2, 3, 4]) for (const v of flat(mezzotint2D(img, kind, 5, 0))) {
      expect(v === 0 || v === MEZZOTINT_MAX).toBe(true);
    }
  });

  it("forces a fully-white field to white and a fully-black field to black", () => {
    expect(mezzotint2D(grid(8, 8, () => 65535), 0, 9, 0)).toEqual(grid(8, 8, () => 65535)); // val 1 ≥ any hash<1
    expect(mezzotint2D(grid(8, 8, () => 0), 0, 9, 0)).toEqual(grid(8, 8, () => 0)); // val 0 ≥ hash only if hash 0
  });

  it("is deterministic and sensitive to seed and channel", () => {
    expect(mezzotint2D(img, 0, 42, 0)).toEqual(mezzotint2D(img, 0, 42, 0));
    expect(mezzotint2D(img, 0, 1, 0)).not.toEqual(mezzotint2D(img, 0, 2, 0)); // seed
    expect(mezzotint2D(img, 0, 42, 0)).not.toEqual(mezzotint2D(img, 0, 42, 1)); // channel
  });

  it("handles empty / 1×1 images and does not mutate the input", () => {
    expect(mezzotint2D([], 0, 1)).toEqual([]);
    expect(mezzotint2D([[], []], 0, 1)).toEqual([[], []]);
    const snapshot = img.map((r) => [...r]);
    mezzotint2D(img, 2, 3, 0);
    expect(img).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const out = mezzotint2D(greyHash(5, 9), 1, 4, 0);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 9)).toBe(true);
  });
});

// ── Cross-implementation goldens from the Rust engine's `mezzotint` (channel 0) over a grey field
//    v=(x·9973+y·9931)%65535. Covers all five kinds: dots (block 1/2/3) and horizontal/vertical
//    lines. The hash is exact; these pin the cell selection and the threshold. ──
describe("engine golden (mezzotint, channel 0)", () => {
  const img = greyHash(12, 12);
  it("matches the engine bit-exactly — kind 0 dots (block 1), seed 42", () => {
    expect(mezzotint2D(img, 0, 42, 0)).toEqual(
      rows(12, "0 0 0 0 65535 65535 0 0 65535 65535 0 65535 0 65535 0 65535 65535 65535 0 0 0 0 65535 65535 0 0 65535 65535 0 0 0 0 0 65535 65535 65535 65535 65535 65535 0 0 0 65535 65535 65535 65535 65535 0 0 65535 65535 65535 0 0 65535 65535 65535 65535 0 0 65535 65535 0 65535 65535 65535 65535 65535 65535 0 65535 0 65535 0 0 0 0 65535 0 65535 0 0 0 65535 0 0 0 65535 65535 65535 65535 65535 0 65535 0 65535 0 65535 0 65535 0 65535 0 0 0 0 65535 65535 0 0 65535 65535 65535 0 0 0 65535 65535 65535 0 65535 65535 65535 65535 0 0 65535 0 65535 65535 0 0 65535 65535 0 0 0 0 65535 65535 65535 0 0 65535"),
    );
  });
  it("matches the engine bit-exactly — kind 1 dots (block 2), seed 42", () => {
    expect(mezzotint2D(img, 1, 42, 0)).toEqual(
      rows(12, "0 0 0 0 65535 65535 0 0 65535 65535 65535 65535 0 65535 0 65535 65535 65535 0 0 65535 65535 65535 65535 65535 65535 65535 65535 65535 0 65535 65535 0 0 65535 65535 65535 65535 65535 65535 0 0 65535 65535 0 65535 65535 0 0 65535 65535 0 65535 65535 65535 65535 0 65535 0 0 65535 65535 0 0 65535 65535 65535 65535 65535 0 0 0 65535 0 65535 65535 65535 65535 0 65535 0 0 0 0 0 0 65535 65535 65535 65535 65535 0 0 0 0 0 0 0 0 65535 65535 65535 65535 65535 65535 65535 65535 65535 0 0 65535 65535 65535 65535 65535 65535 65535 65535 65535 0 65535 65535 65535 65535 0 0 65535 65535 65535 65535 0 0 65535 65535 65535 65535 0 65535 65535 65535 65535 0 0 0"),
    );
  });
  it("matches the engine bit-exactly — kind 2 dots (block 3), seed 42", () => {
    expect(mezzotint2D(img, 2, 42, 0)).toEqual(
      rows(12, "0 0 65535 0 65535 65535 65535 0 0 0 0 0 0 65535 65535 65535 65535 65535 0 0 0 0 0 0 65535 65535 65535 65535 65535 0 0 0 65535 0 0 65535 65535 65535 65535 65535 0 0 0 0 65535 65535 65535 65535 65535 65535 65535 0 0 65535 0 65535 65535 65535 65535 65535 65535 65535 0 0 65535 65535 65535 65535 65535 65535 65535 65535 65535 0 0 0 0 0 65535 65535 65535 65535 65535 65535 0 0 0 0 0 65535 65535 65535 65535 65535 65535 65535 0 0 0 0 65535 65535 65535 65535 65535 65535 65535 65535 0 65535 65535 65535 65535 0 0 65535 65535 0 0 0 65535 65535 65535 65535 0 65535 65535 65535 65535 0 0 0 65535 65535 65535 0 65535 65535 65535 65535 65535 0 0 0"),
    );
  });
  it("matches the engine bit-exactly — kind 3 horizontal lines, seed 7", () => {
    expect(mezzotint2D(img, 3, 7, 0)).toEqual(
      rows(12, "0 0 0 0 65535 65535 65535 0 0 0 0 65535 0 0 0 65535 65535 65535 0 0 0 0 65535 65535 0 65535 65535 65535 65535 0 0 0 65535 65535 65535 65535 0 0 65535 65535 0 0 0 0 65535 65535 65535 0 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 0 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 0 0 65535 65535 65535 65535 65535 0 0 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 65535 0 0 65535 65535 65535 65535 0 0 0 65535 65535 65535 0 0 0 0 65535 0 0 0 0 0 0 0 0 65535 65535 65535 0 0 0 65535 65535 65535 0 0 65535 65535 65535 0 65535 65535 65535 65535 65535 0 65535 65535"),
    );
  });
  it("matches the engine bit-exactly — kind 4 vertical lines, seed 7", () => {
    expect(mezzotint2D(img, 4, 7, 0)).toEqual(
      rows(12, "0 0 0 0 65535 65535 65535 0 0 65535 0 65535 0 0 0 0 65535 65535 0 0 0 65535 0 65535 0 0 65535 0 65535 0 0 0 0 65535 0 65535 0 0 65535 65535 0 0 65535 65535 0 65535 0 0 65535 65535 65535 0 0 65535 65535 65535 0 65535 0 0 65535 65535 0 0 65535 65535 65535 65535 0 0 0 65535 65535 0 0 0 65535 65535 65535 65535 0 65535 0 65535 0 0 0 0 65535 65535 65535 0 0 65535 0 65535 0 0 65535 0 65535 65535 0 0 0 65535 0 65535 0 0 65535 0 65535 0 65535 0 0 65535 0 0 0 0 65535 65535 0 65535 65535 65535 0 65535 0 0 65535 65535 65535 0 0 65535 65535 65535 0 0 0 65535"),
    );
  });
  // channel 1 (green) — exercises hash(...,1) and thus the 0xC2B2AE35 channel constant that the
  // channel-0 goldens above leave at 0. Without this, a wrong-but-nonzero channel constant survives.
  it("matches the engine bit-exactly — kind 0 CHANNEL 1, seed 42 (pins the 0xC2B2AE35 channel term)", () => {
    expect(mezzotint2D(img, 0, 42, 1)).toEqual(
      rows(12, "0 0 65535 65535 0 0 65535 65535 0 0 0 0 0 0 0 65535 65535 65535 0 0 0 0 65535 0 0 65535 65535 65535 65535 0 0 65535 65535 0 65535 65535 0 0 65535 65535 65535 65535 0 65535 65535 65535 65535 0 0 65535 65535 0 0 65535 65535 0 65535 65535 0 65535 65535 65535 0 0 65535 65535 65535 65535 65535 65535 0 65535 65535 0 0 65535 65535 65535 0 65535 0 0 65535 65535 0 0 65535 65535 65535 65535 65535 0 0 0 65535 65535 0 0 0 65535 65535 65535 0 0 0 65535 65535 65535 0 0 0 65535 65535 0 0 65535 0 65535 65535 0 65535 65535 0 65535 0 65535 65535 0 0 0 0 0 0 0 65535 0 0 65535 65535 65535 0 0 0 65535"),
    );
  });
});

// ── f32-vs-f64 threshold discriminators (kind 0, 1×1, channel 0). fr(v/65535) just clears the cell
//    threshold while the f64 value v/65535 does not, so the engine emits white where a fround-free
//    mirror emits black. Captured from the real engine. ──
describe("engine f32-vs-f64 threshold discriminator (mezzotint)", () => {
  it.each([
    { v: 65504, seed: 367 },
    { v: 65473, seed: 734 },
  ])("v=$v seed=$seed: f32 clears the threshold (white) where f64 would not (black)", ({ v, seed }) => {
    expect(mezzotint2D([[v]], 0, seed, 0)).toEqual([[MEZZOTINT_MAX]]);
  });
});
