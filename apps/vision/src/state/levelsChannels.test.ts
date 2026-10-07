// Unit tests for the Levels per-channel helpers. Engine-free (node); the dialog +
// engine wiring are covered by e2e/levels-channel.spec.ts + a Rust test.
import { describe, it, expect } from "vitest";
import {
  packLevels, defaultLevels, LEVELS_CHANNELS,
  levelsTransfer, applyLevelsChannel, applyLevels, applyLevelsMulti,
  type LevelsParams,
} from "./levelsChannels";

// A LevelsParams with identity defaults overridden by `over`.
const lv = (over: Partial<LevelsParams> = {}): LevelsParams => ({ ...defaultLevels(), ...over });

// Float32Array stores f32, so compare the normalised fractions approximately.
const close = (got: Float32Array, want: number[]) =>
  want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 5));

describe("packLevels", () => {
  it("identity packs to [0,1,1,0,1] exactly", () => {
    expect(Array.from(packLevels(defaultLevels()))).toEqual([0, 1, 1, 0, 1]);
  });

  it("normalises the 0..255 fields to 0..1 (gamma kept as-is)", () => {
    close(packLevels({ ib: 51, iw: 204, gamma: 1.5, ob: 0, ow: 255 }), [0.2, 0.8, 1.5, 0, 1]);
    close(packLevels({ ib: 0, iw: 255, gamma: 1, ob: 64, ow: 191 }), [0, 1, 1, 64 / 255, 191 / 255]);
  });
});

describe("LEVELS_CHANNELS", () => {
  it("offers RGB + the three channels in order", () => {
    expect(LEVELS_CHANNELS.map((c) => c.value)).toEqual([0, 1, 2, 3]);
    expect(LEVELS_CHANNELS.map((c) => c.label)).toEqual(["RGB", "Red", "Green", "Blue"]);
  });
});

describe("levelsTransfer (mirrors adjust.rs levels_one)", () => {
  it("identity maps c → c", () => {
    for (const c of [0, 0.25, 0.5, 0.75, 1]) expect(levelsTransfer(c, 0, 1, 1, 0, 1)).toBeCloseTo(c, 9);
  });

  it("clips below in-black and above in-white", () => {
    expect(levelsTransfer(0.2, 0.25, 0.75, 1, 0, 1)).toBe(0); // below ib → 0
    expect(levelsTransfer(0.8, 0.25, 0.75, 1, 0, 1)).toBe(1); // above iw → 1
    expect(levelsTransfer(0.5, 0.25, 0.75, 1, 0, 1)).toBeCloseTo(0.5, 9); // mid of range
  });

  it("remaps to the output range", () => {
    expect(levelsTransfer(0, 0, 1, 1, 0.2, 0.8)).toBeCloseTo(0.2, 9);
    expect(levelsTransfer(1, 0, 1, 1, 0.2, 0.8)).toBeCloseTo(0.8, 9);
  });

  it("gamma>1 brightens midtones (1/gamma power)", () => {
    expect(levelsTransfer(0.25, 0, 1, 2, 0, 1)).toBeCloseTo(0.5, 9); // 0.25^0.5
  });

  it("guards a zero/inverted input span and zero gamma (no NaN/Inf)", () => {
    expect(Number.isFinite(levelsTransfer(0.5, 0.5, 0.5, 1, 0, 1))).toBe(true); // iw==ib
    expect(Number.isFinite(levelsTransfer(0.5, 0, 1, 0, 0, 1))).toBe(true); // gamma 0
    // inverted span (iw < ib): the 1e-4 floor makes it a hard step at ib.
    expect(levelsTransfer(0.2, 0.75, 0.25, 1, 0, 1)).toBe(0); // below ib → 0
    expect(levelsTransfer(0.9, 0.75, 0.25, 1, 0, 1)).toBe(1); // above ib → clamps to 1
  });
});

describe("applyLevelsChannel — 8-bit transfer", () => {
  it("identity is a no-op for every value", () => {
    for (let v = 0; v <= 255; v++) expect(applyLevelsChannel(v, defaultLevels())).toBe(v);
  });

  it("input black point (ib=64): 64→0, 128→85, 255→255", () => {
    const p = lv({ ib: 64 });
    expect(applyLevelsChannel(64, p)).toBe(0);
    expect(applyLevelsChannel(32, p)).toBe(0);
    expect(applyLevelsChannel(128, p)).toBe(85);
    expect(applyLevelsChannel(255, p)).toBe(255);
  });

  it("input white point (iw=192): 96→128, 192→255, 255→255", () => {
    const p = lv({ iw: 192 });
    expect(applyLevelsChannel(96, p)).toBe(128);
    expect(applyLevelsChannel(192, p)).toBe(255);
    expect(applyLevelsChannel(255, p)).toBe(255);
  });

  it("gamma 2 brightens (64→128); gamma 0.5 darkens", () => {
    expect(applyLevelsChannel(64, lv({ gamma: 2 }))).toBe(128);
    expect(applyLevelsChannel(180, lv({ gamma: 0.5 })) < 180).toBe(true);
  });

  it("output range (ob=32, ow=224): 0→32, 255→224", () => {
    const p = lv({ ob: 32, ow: 224 });
    expect(applyLevelsChannel(0, p)).toBe(32);
    expect(applyLevelsChannel(255, p)).toBe(224);
  });

  it("is monotonic across the ramp (gamma>0)", () => {
    const p = lv({ ib: 20, iw: 230, gamma: 1.3, ob: 10, ow: 245 });
    let prev = -1;
    for (let v = 0; v <= 255; v++) {
      const out = applyLevelsChannel(v, p);
      expect(out).toBeGreaterThanOrEqual(prev);
      prev = out;
    }
  });
});

describe("applyLevels / applyLevelsMulti (composite then per-channel)", () => {
  it("applyLevels applies one set to all channels", () => {
    expect(applyLevels(lv({ gamma: 2 }), 64, 64, 64)).toEqual({ r: 128, g: 128, b: 128 });
    expect(applyLevels(defaultLevels(), 10, 120, 240)).toEqual({ r: 10, g: 120, b: 240 });
  });

  it("identity composite → multi equals the per-channel apply", () => {
    const red = lv({ gamma: 1.5 }), grn = lv({ ib: 30 }), blu = lv({ ow: 200 });
    for (const [r, g, b] of [
      [40, 130, 220],
      [200, 60, 90],
    ]) {
      expect(applyLevelsMulti(defaultLevels(), red, grn, blu, r, g, b)).toEqual({
        r: applyLevelsChannel(r, red),
        g: applyLevelsChannel(g, grn),
        b: applyLevelsChannel(b, blu),
      });
    }
  });

  it("identity per-channels → multi equals the composite apply", () => {
    const comp = lv({ ib: 20, iw: 235, gamma: 1.4 });
    const id = defaultLevels();
    for (const [r, g, b] of [
      [40, 130, 220],
      [255, 0, 128],
    ]) {
      expect(applyLevelsMulti(comp, id, id, id, r, g, b)).toEqual(applyLevels(comp, r, g, b));
    }
  });

  it("composes both stages in normalised space (deterministic)", () => {
    const comp = lv({ gamma: 1.8 }), red = lv({ ib: 40 }), grn = lv({ gamma: 0.7 }), blu = lv({ ow: 210 });
    const out = applyLevelsMulti(comp, red, grn, blu, 90, 150, 210);
    for (const c of [out.r, out.g, out.b]) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
    expect(applyLevelsMulti(comp, red, grn, blu, 90, 150, 210)).toEqual(out);
  });

  it("composes the two stages in normalised space, rounding only once at the end", () => {
    // Independently recompute with the two transfers in 0..1 space and a single
    // final byte — applyLevelsMulti must match this (NOT round between stages).
    const comp = lv({ ib: 10, iw: 245, gamma: 1.7 });
    const per = lv({ gamma: 0.5, ow: 230 });
    const tr = (c: number, p: LevelsParams) => levelsTransfer(c, p.ib / 255, p.iw / 255, p.gamma, p.ob / 255, p.ow / 255);
    const b8 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
    for (let v = 0; v <= 255; v++) {
      expect(applyLevelsMulti(comp, per, per, per, v, v, v).r).toBe(b8(tr(tr(v / 255, comp), per)));
    }
  });
});

// ── Several fixtures swept for in-gamut + determinism ───────────────────────
const FIXTURES: { name: string; params: LevelsParams }[] = [
  { name: "lift blacks", params: lv({ ib: 40 }) },
  { name: "pull whites", params: lv({ iw: 210 }) },
  { name: "brighten gamma", params: lv({ gamma: 1.6 }) },
  { name: "darken gamma", params: lv({ gamma: 0.6 }) },
  { name: "compress output", params: lv({ ob: 24, ow: 230 }) },
  { name: "full S-ish", params: lv({ ib: 30, iw: 225, gamma: 1.2, ob: 8, ow: 248 }) },
];

describe.each(FIXTURES)("fixture: $name", ({ params }) => {
  it("produces finite, in-gamut, deterministic output across a ramp", () => {
    for (const v of [0, 32, 64, 128, 192, 255]) {
      const out = applyLevels(params, v, v, v);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applyLevels(params, v, v, v)).toEqual(out);
    }
  });
});
