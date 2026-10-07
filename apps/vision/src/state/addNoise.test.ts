// Unit tests for the Add Noise filter. Engine-free (node). The randomness is a seeded
// xorshift32 PRNG, so "random" is fully testable: these pin the PRNG bit-for-bit against
// an independent BigInt oracle, the noise-value f32 conversion, the per-pixel draw rules
// (monochromatic shares one delta; otherwise three), truncating quantization, clamping,
// determinism, and amount=0 identity. Must match filters.rs add_noise.
import { describe, it, expect } from "vitest";
import {
  xorshift32Step,
  makeXorshift32,
  noiseValue,
  makeNoiseRng,
  noiseAmplitude,
  noiseDelta,
  applyNoiseChannel,
  addNoisePixel,
  addNoise,
  packAddNoiseParams,
  unpackAddNoiseParams,
  NOISE_MAX,
} from "./addNoise";

// Independent oracle: xorshift32 in BigInt masked to 32 bits — unambiguous u32 math,
// so it catches any JS signed/unsigned shift bug in the Number-based implementation.
const M32 = 0xffffffffn;
const stepBig = (s0: bigint): bigint => {
  let s = s0 & M32;
  s ^= (s << 13n) & M32;
  s ^= s >> 17n; // logical (s is a non-negative BigInt)
  s ^= (s << 5n) & M32;
  return s & M32;
};

describe("xorshift32Step (vs BigInt oracle)", () => {
  it("matches the u32 oracle over many iterations, including sign-bit states", () => {
    for (const seed of [1, 2, 12345, 0x80000000, 0xffffffff, 0xdeadbeef, 0x12345678]) {
      let js = seed >>> 0;
      let big = BigInt(js);
      for (let k = 0; k < 500; k++) {
        js = xorshift32Step(js);
        big = stepBig(big);
        expect(js).toBe(Number(big));
      }
    }
  });

  it("is a pure function and never produces 0 from a non-zero state", () => {
    expect(xorshift32Step(12345)).toBe(xorshift32Step(12345));
    let s = 1;
    for (let k = 0; k < 10000; k++) {
      s = xorshift32Step(s);
      expect(s).not.toBe(0);
    }
  });
});

describe("makeXorshift32 (engine seeding seed|1)", () => {
  it("forces the seed odd, so seed 0 and seed 1 share a sequence", () => {
    const a = makeXorshift32(0);
    const b = makeXorshift32(1);
    for (let k = 0; k < 8; k++) expect(a()).toBe(b()); // both start from state 1
  });

  it("seed 2 and seed 3 also share a sequence (2|1 === 3|1 === 3)", () => {
    const a = makeXorshift32(2);
    const b = makeXorshift32(3);
    for (let k = 0; k < 8; k++) expect(a()).toBe(b());
  });

  it("matches an oracle generator seeded the same way (incl. high seeds)", () => {
    for (const seed of [1, 42, 0x80000000, 0xfffffffe]) {
      const gen = makeXorshift32(seed);
      let big = BigInt((seed | 1) >>> 0);
      for (let k = 0; k < 200; k++) {
        big = stepBig(big);
        expect(gen()).toBe(Number(big));
      }
    }
  });

  it("different seeds give different sequences; same seed is deterministic", () => {
    expect(makeXorshift32(1)()).not.toBe(makeXorshift32(100)());
    expect(makeXorshift32(7)()).toBe(makeXorshift32(7)());
  });
});

describe("noiseValue", () => {
  it("stays in [−1, 1] across the state range", () => {
    for (let i = 0; i <= 64; i++) {
      const state = Math.floor((i / 64) * 4294967295) >>> 0;
      const v = noiseValue(state);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("maps the endpoints: max state → 1, half state → 0, state 1 → ≈ −1", () => {
    expect(noiseValue(0xffffffff)).toBe(1); // fr(2³²−1)=2³² → /2³² = 1 → ·2−1 = 1
    expect(noiseValue(0x80000000)).toBe(0); // 0.5 → ·2−1 = 0
    expect(noiseValue(1)).toBeLessThan(-0.999);
  });

  it("returns an f32-stable value", () => {
    const v = noiseValue(0x12345678);
    expect(v).toBe(Math.fround(v));
  });

  it("makeNoiseRng composes the verified step + conversion (oracle-pinned first draw)", () => {
    expect(makeNoiseRng(1)()).toBe(noiseValue(Number(stepBig(1n))));
  });
});

describe("noiseAmplitude / noiseDelta", () => {
  it("amplitude is amount·65535", () => {
    expect(noiseAmplitude(0)).toBe(0);
    expect(noiseAmplitude(1)).toBe(NOISE_MAX);
    expect(noiseAmplitude(0.5)).toBeCloseTo(32767.5, 4);
  });

  it("delta scales with noise, amplitude, and coverage", () => {
    expect(noiseDelta(0, 65535, 1)).toBe(0); // zero noise → zero delta
    expect(noiseDelta(1, 65535, 1)).toBeCloseTo(65535, 4);
    expect(noiseDelta(0.5, 65535, 1)).toBeCloseTo(32767.5, 4);
    expect(noiseDelta(1, 65535, 0.5)).toBeCloseTo(32767.5, 4); // half coverage halves it
  });
});

describe("applyNoiseChannel (clamp + truncate)", () => {
  it("a zero delta leaves the channel unchanged", () => {
    expect(applyNoiseChannel(1000, 0)).toBe(1000);
  });

  it("truncates toward zero (not round-half-up)", () => {
    expect(applyNoiseChannel(1000, 0.9)).toBe(1000); // trunc(1000.9)
    expect(applyNoiseChannel(1000, 1.9)).toBe(1001); // trunc(1001.9)
    expect(applyNoiseChannel(1000, -0.3)).toBe(999); // trunc(999.7)
  });

  it("clamps to [0, 65535]", () => {
    expect(applyNoiseChannel(65535, 1000)).toBe(NOISE_MAX);
    expect(applyNoiseChannel(65000, 2000)).toBe(NOISE_MAX);
    expect(applyNoiseChannel(0, -1000)).toBe(0);
    expect(applyNoiseChannel(100, -500)).toBe(0);
  });
});

describe("addNoisePixel", () => {
  const amt = noiseAmplitude(0.5);

  it("monochromatic shares one delta, keeping a neutral pixel neutral", () => {
    const out = addNoisePixel(makeXorshift32(123), 30000, 30000, 30000, amt, true);
    expect(out.r).toBe(out.g);
    expect(out.g).toBe(out.b);
  });

  it("monochromatic applies one shared delta, so channel gaps survive (±1)", () => {
    // small amount → no channel clamps (stays in [3446, 36553]); one shared delta keeps
    // the 10000 gaps intact to within ±1 (independent per-channel f32 rounding + trunc).
    const out = addNoisePixel(makeXorshift32(55), 10000, 20000, 30000, noiseAmplitude(0.1), true);
    expect(Math.abs(out.g - out.r - 10000)).toBeLessThanOrEqual(1);
    expect(Math.abs(out.b - out.g - 10000)).toBeLessThanOrEqual(1);
  });

  it("non-monochromatic draws independently and breaks neutrality", () => {
    const out = addNoisePixel(makeXorshift32(123), 30000, 30000, 30000, noiseAmplitude(1), false);
    expect(out.r === out.g && out.g === out.b).toBe(false);
  });

  it("amount 0 is the identity for both modes", () => {
    expect(addNoisePixel(makeXorshift32(9), 111, 222, 333, 0, true)).toEqual({ r: 111, g: 222, b: 333 });
    expect(addNoisePixel(makeXorshift32(9), 111, 222, 333, 0, false)).toEqual({ r: 111, g: 222, b: 333 });
  });

  it("coverage scales the delta (cov 0 → identity, cov 0.5 → half the shift)", () => {
    // cov 0 zeroes the delta → identity, exercising the partial-coverage parameter path
    expect(addNoisePixel(makeXorshift32(9), 111, 222, 333, noiseAmplitude(1), true, 0)).toEqual({
      r: 111,
      g: 222,
      b: 333,
    });
    // cov 0.5 must equal applying half-amplitude noise from the same PRNG draw
    const d = noiseDelta(noiseValue(makeXorshift32(9)()), noiseAmplitude(0.4), 0.5);
    const out = addNoisePixel(makeXorshift32(9), 20000, 20000, 20000, noiseAmplitude(0.4), true, 0.5);
    expect(out.r).toBe(applyNoiseChannel(20000, d));
  });
});

describe("addNoise (flat u16 RGBA buffer)", () => {
  // 3 pixels, distinctive alphas to prove alpha is untouched.
  const buf = () => [10000, 20000, 30000, 40000, 5000, 15000, 25000, 35000, 60000, 1000, 500, 65535];

  it("amount 0 returns an identical buffer (a fresh copy)", () => {
    const src = buf();
    const out = addNoise(src, 0, false, 777);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it("leaves the alpha channel untouched", () => {
    const src = buf();
    const out = addNoise(src, 0.8, false, 4242);
    expect(out[3]).toBe(src[3]);
    expect(out[7]).toBe(src[7]);
    expect(out[11]).toBe(src[11]);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    const src = buf();
    expect(addNoise(src, 0.5, false, 2024)).toEqual(addNoise(src, 0.5, false, 2024));
    expect(addNoise(src, 0.5, false, 2024)).not.toEqual(addNoise(src, 0.5, false, 9999));
  });

  it("monochromatic keeps a neutral buffer neutral per pixel", () => {
    const gray = [30000, 30000, 30000, 65535, 12000, 12000, 12000, 65535];
    const out = addNoise(gray, 0.6, true, 314);
    for (let p = 0; p < out.length; p += 4) {
      expect(out[p]).toBe(out[p + 1]);
      expect(out[p + 1]).toBe(out[p + 2]);
    }
  });

  it("non-monochromatic breaks neutrality somewhere in a gray buffer", () => {
    const gray = [30000, 30000, 30000, 65535, 12000, 12000, 12000, 65535];
    const out = addNoise(gray, 0.8, false, 314);
    let broken = false;
    for (let p = 0; p < out.length; p += 4) {
      if (!(out[p] === out[p + 1] && out[p + 1] === out[p + 2])) broken = true;
    }
    expect(broken).toBe(true);
  });

  it("keeps every channel within [0, 65535] at extreme amounts and inputs", () => {
    const extreme = [65535, 65535, 65535, 65535, 0, 0, 0, 65535, 32768, 100, 65000, 200];
    for (const mono of [true, false]) {
      const out = addNoise(extreme, 1, mono, 8675309);
      for (let i = 0; i < out.length; i++) {
        expect(Number.isInteger(out[i])).toBe(true);
        expect(out[i]).toBeGreaterThanOrEqual(0);
        expect(out[i]).toBeLessThanOrEqual(NOISE_MAX);
      }
    }
  });

  it("monochromatic and non-monochromatic diverge (draw counts differ: n vs 3n)", () => {
    const src = buf();
    expect(addNoise(src, 0.5, true, 111)).not.toEqual(addNoise(src, 0.5, false, 111));
  });
});

describe("smart-filter params (id 11)", () => {
  it("packs [amount, mono?1:0, seed]", () => {
    expect(packAddNoiseParams(0.12, false, 12345)).toEqual([0.12, 0, 12345]);
    expect(packAddNoiseParams(0.5, true, 99)).toEqual([0.5, 1, 99]);
  });

  it("unpacks params, coercing the flag and uint32 seed", () => {
    expect(unpackAddNoiseParams([0.12, 0, 12345])).toEqual({ amount: 0.12, monochromatic: false, seed: 12345 });
    expect(unpackAddNoiseParams([0.5, 1, 99])).toEqual({ amount: 0.5, monochromatic: true, seed: 99 });
    expect(unpackAddNoiseParams([])).toEqual({ amount: 0, monochromatic: false, seed: 0 });
    // (-1) >>> 0 — JS two's-complement wrap; documents JS coercion, not engine parity
    // (valid seeds are always non-negative u32, so this branch is unreachable in practice)
    expect(unpackAddNoiseParams([0, 0, -1]).seed).toBe(4294967295);
  });

  it("f32-rounds the seed on unpack (mirrors the engine reading an f32 param as u32)", () => {
    // seeds ≥ 2²⁴ can't be represented exactly in f32, so the engine's stored param and a
    // JS replay must round identically: 3000000001 → nearest f32 multiple of 256 = 3000000000
    expect(unpackAddNoiseParams([0.5, 1, 3000000001]).seed).toBe(Math.fround(3000000001) >>> 0);
    expect(unpackAddNoiseParams([0.5, 1, 3000000001]).seed).toBe(3000000000);
    // and the replay through pack → f32 unpack reproduces the field for a large seed
    const src = [12345, 23456, 34567, 65535, 1000, 2000, 3000, 65535];
    const { amount, monochromatic, seed } = unpackAddNoiseParams(packAddNoiseParams(0.4, false, 3000000000));
    expect(addNoise(src, amount, monochromatic, seed)).toEqual(addNoise(src, 0.4, false, 3000000000));
  });

  it("round-trips and replays the same field from packed params", () => {
    const src = [12345, 23456, 34567, 65535, 1000, 2000, 3000, 65535];
    const params = packAddNoiseParams(0.4, true, 55555);
    const { amount, monochromatic, seed } = unpackAddNoiseParams(params);
    expect(addNoise(src, amount, monochromatic, seed)).toEqual(addNoise(src, 0.4, true, 55555));
  });
});
