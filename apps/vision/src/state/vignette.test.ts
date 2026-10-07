// Unit tests for the Vignette filter. Engine-free (node). These pin the radial darkening
// factor (must match filters.rs vignette: f = clamp01(1 − amount·d²·2), d = distance from
// centre / half-diagonal), the truncating channel scale ((v·f) as u16), and the defining
// behaviours: amount 0 is the identity, the centre pixel is untouched, corners darken
// most, the falloff is radially monotonic, and vignette only ever darkens.
import { describe, it, expect } from "vitest";
import {
  vignetteFactor,
  applyVignetteChannel,
  vignette,
  packVignetteParams,
  unpackVignetteParams,
  VIGNETTE_MAX,
} from "./vignette";

// A flat w×h RGBA u16 buffer filled with `val` (opaque unless an alpha is given).
const buildBuf = (w: number, h: number, val: number, alpha = VIGNETTE_MAX): number[] => {
  const out: number[] = [];
  for (let i = 0; i < w * h; i++) out.push(val, val, val, alpha);
  return out;
};

describe("vignetteFactor", () => {
  it("amount 0 is 1 everywhere (no darkening)", () => {
    for (const [x, y] of [
      [0, 0],
      [5, 5],
      [9, 9],
      [3, 7],
    ]) {
      expect(vignetteFactor(x, y, 10, 10, 0)).toBe(1);
    }
  });

  it("the pixel at exactly (w/2, h/2) is never darkened (d = 0 → f = 1)", () => {
    for (const a of [0.1, 0.5, 1]) expect(vignetteFactor(5, 5, 10, 10, a)).toBeCloseTo(1, 6);
  });

  it("a square image's far corner factor is clamp01(1 − 2·amount)", () => {
    // corner (0,0): d = 1 exactly → f = clamp01(1 − amount·2)
    expect(vignetteFactor(0, 0, 10, 10, 0.1)).toBeCloseTo(0.8, 4);
    expect(vignetteFactor(0, 0, 10, 10, 0.25)).toBeCloseTo(0.5, 4);
    expect(vignetteFactor(0, 0, 10, 10, 0.4)).toBeCloseTo(0.2, 4);
    expect(vignetteFactor(0, 0, 10, 10, 0.5)).toBeCloseTo(0, 4); // 1 − 1 → 0
    expect(vignetteFactor(0, 0, 10, 10, 0.8)).toBe(0); // 1 − 1.6 → clamp 0
  });

  it("stays within [0,1] across positions and amounts", () => {
    for (const a of [0, 0.3, 0.6, 1]) {
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          const f = vignetteFactor(x, y, 12, 12, a);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("falls off monotonically from the centre to the corner (along the diagonal)", () => {
    let prev = Infinity;
    for (let s = 5; s >= 0; s--) {
      const f = vignetteFactor(s, s, 10, 10, 0.3); // (5,5)=centre → (0,0)=corner
      expect(f).toBeLessThanOrEqual(prev + 1e-6); // never increases toward the corner
      prev = f;
    }
  });

  it("more amount darkens more at a fixed (un-clamped) position", () => {
    const at = (a: number) => vignetteFactor(2, 2, 10, 10, a);
    expect(at(0.3)).toBeLessThan(at(0.1));
    expect(at(0.5)).toBeLessThan(at(0.3));
  });

  it("guards maxd at 1 for a 1×1 image (no divide-by-zero)", () => {
    // cx=cy=0.5, maxd=max(√0.5, 1)=1, d=√0.5 → f = clamp01(1 − 0.5·0.5·2) = 0.5
    expect(vignetteFactor(0, 0, 1, 1, 0.5)).toBeCloseTo(0.5, 6);
    expect(vignetteFactor(0, 0, 1, 1, 0)).toBe(1);
  });

  it("clamps amounts outside 0..1 (defensive: >1 → black corner, <0 → no brightening)", () => {
    expect(vignetteFactor(0, 0, 10, 10, 2)).toBe(0); // 1 − 4 → clamp 0
    expect(vignetteFactor(0, 0, 10, 10, -0.5)).toBe(1); // 1 + 1 → clamp 1 (never brightens)
    expect(vignetteFactor(3, 3, 10, 10, -1)).toBe(1); // negative amount never lifts above 1
  });
});

describe("applyVignetteChannel (truncating scale)", () => {
  it("a factor of 1 leaves the channel unchanged, 0 zeroes it", () => {
    expect(applyVignetteChannel(50000, 1)).toBe(50000);
    expect(applyVignetteChannel(50000, 0)).toBe(0);
  });

  it("truncates toward zero (not round-half-up)", () => {
    expect(applyVignetteChannel(255, 0.5)).toBe(127); // 127.5 → 127, not 128
    expect(applyVignetteChannel(VIGNETTE_MAX, 0.5)).toBe(32767); // 32767.5 → 32767
    expect(applyVignetteChannel(100, 0.999)).toBe(99); // 99.9 → 99
  });

  it("never brightens (output ≤ input for f ≤ 1)", () => {
    for (const v of [0, 1000, 30000, 65535]) {
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        expect(applyVignetteChannel(v, f)).toBeLessThanOrEqual(v);
      }
    }
  });
});

describe("vignette (flat u16 RGBA buffer)", () => {
  it("amount 0 returns an identical buffer (a fresh copy)", () => {
    const src = buildBuf(8, 6, 40000);
    const out = vignette(src, 8, 6, 0);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it("darkens the corners while leaving the centre pixel untouched", () => {
    const src = buildBuf(10, 10, VIGNETTE_MAX);
    const out = vignette(src, 10, 10, 0.4);
    const corner = out[0]; // (0,0)
    const centre = out[(5 * 10 + 5) * 4]; // (5,5) → f = 1
    expect(corner).toBeLessThan(centre);
    expect(centre).toBe(VIGNETTE_MAX); // exactly at w/2,h/2 → untouched
    expect(corner).toBe(applyVignetteChannel(VIGNETTE_MAX, vignetteFactor(0, 0, 10, 10, 0.4)));
  });

  it("leaves the alpha channel untouched", () => {
    const src = buildBuf(6, 6, 50000, 12345);
    const out = vignette(src, 6, 6, 0.6);
    for (let p = 3; p < out.length; p += 4) expect(out[p]).toBe(12345);
  });

  it("only ever darkens, and stays in range", () => {
    const src = buildBuf(9, 7, 48000);
    const out = vignette(src, 9, 7, 0.5);
    for (let i = 0; i < out.length; i++) {
      if (i % 4 === 3) continue; // skip alpha
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(48000); // never above the original
    }
  });

  it("a larger amount darkens the corner further and is deterministic", () => {
    const src = buildBuf(10, 10, VIGNETTE_MAX);
    const soft = vignette(src, 10, 10, 0.2);
    const strong = vignette(src, 10, 10, 0.6);
    expect(strong[0]).toBeLessThan(soft[0]); // corner darker at higher amount
    expect(vignette(src, 10, 10, 0.4)).toEqual(vignette(src, 10, 10, 0.4)); // deterministic
  });
});

describe("smart-filter params (id 10)", () => {
  it("packs and unpacks [amount], f32-rounding on unpack", () => {
    expect(packVignetteParams(0.4)).toEqual([0.4]);
    expect(unpackVignetteParams([0.4])).toBe(Math.fround(0.4));
    expect(unpackVignetteParams([])).toBe(0);
  });

  it("round-trips and replays the same falloff", () => {
    const src = buildBuf(8, 8, 60000);
    const amount = unpackVignetteParams(packVignetteParams(0.45));
    expect(vignette(src, 8, 8, amount)).toEqual(vignette(src, 8, 8, Math.fround(0.45)));
  });
});

// ── Several image/amount fixtures swept for darken-only, range, and corner≤centre ──
const FIXTURES: { name: string; w: number; h: number; val: number; amount: number }[] = [
  { name: "square soft", w: 12, h: 12, val: 65535, amount: 0.25 },
  { name: "wide strong", w: 16, h: 8, val: 40000, amount: 0.6 },
  { name: "tall gentle", w: 6, h: 14, val: 50000, amount: 0.15 },
  { name: "max amount", w: 10, h: 10, val: 65535, amount: 1 },
];

describe.each(FIXTURES)("fixture: $name", ({ w, h, val, amount }) => {
  it("darkens only, stays in range, and the corner is no brighter than the centre", () => {
    const out = vignette(buildBuf(w, h, val), w, h, amount);
    for (let i = 0; i < out.length; i++) {
      if (i % 4 === 3) continue;
      expect(Number.isInteger(out[i])).toBe(true);
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(val);
    }
    const corner = out[0];
    const centreIdx = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
    expect(corner).toBeLessThanOrEqual(out[centreIdx]);
  });
});
