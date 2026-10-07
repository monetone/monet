// ─────────────────────────────────────────────────────────────
// engine/color-harmony.test — Color Guide harmony rules (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Color Guide — harmony rules rotate the base hue on
// the colour wheel, preserving saturation + brightness. Complementary = +180°,
// Triad = +120/240°, Analogous = ±30°, Tetrad = +90/180/270°, Split = +150/210°.

import { describe, it, expect } from "vitest";
import { harmony, HARMONY_RULES, rgba, rgbToHsv } from "./index";

const RED = rgba(255, 0, 0); // hsv h=0, s=1, v=1
const r = (n: number) => Math.round(n);
const rgbOf = (c: { r: number; g: number; b: number }) => ({ r: r(c.r), g: r(c.g), b: r(c.b) });
const hue = (c: Parameters<typeof rgbToHsv>[0]) => Math.round(rgbToHsv(c).h);

describe("harmony", () => {
  it("complementary is the base + its 180° opposite (red → cyan)", () => {
    const [a, b] = harmony(RED, "complementary");
    expect(a).toEqual(RED); // base unchanged
    expect(rgbOf(b)).toEqual({ r: 0, g: 255, b: 255 }); // cyan
    expect(harmony(RED, "complementary")).toHaveLength(2);
  });

  it("triadic is the base + two 120° rotations (red → red, green, blue)", () => {
    const [a, b, c] = harmony(RED, "triadic");
    expect(a).toEqual(RED);
    expect(rgbOf(b)).toEqual({ r: 0, g: 255, b: 0 }); // green (+120)
    expect(rgbOf(c)).toEqual({ r: 0, g: 0, b: 255 }); // blue (+240)
    expect(harmony(RED, "triadic")).toHaveLength(3);
  });

  it("analogous centres the base between ±30° neighbours", () => {
    const out = harmony(RED, "analogous");
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual(RED); // base centred
    expect(hue(out[0])).toBe(330); // base hue (0) − 30 → 330
    expect(hue(out[2])).toBe(30); // base hue + 30
  });

  it("tetradic returns 4 (base + 90/180/270) and split-complementary returns 3 (base + 150/210)", () => {
    const tet = harmony(RED, "tetradic");
    expect(tet).toHaveLength(4);
    expect(tet[0]).toEqual(RED);
    expect([hue(tet[1]), hue(tet[2]), hue(tet[3])]).toEqual([90, 180, 270]);

    const split = harmony(RED, "split-complementary");
    expect(split).toHaveLength(3);
    expect([hue(split[1]), hue(split[2])]).toEqual([150, 210]);
  });

  it("preserves saturation, brightness, and alpha across every rotation", () => {
    const base = rgba(200, 120, 40, 0.5); // mid sat/val, half alpha
    const baseHsv = rgbToHsv(base);
    for (const rule of HARMONY_RULES) {
      for (const c of harmony(base, rule)) {
        const hsv = rgbToHsv(c);
        expect(hsv.s).toBeCloseTo(baseHsv.s, 5);
        expect(hsv.v).toBeCloseTo(baseHsv.v, 5);
        expect(c.a).toBe(0.5); // alpha carried through
      }
    }
  });
});
