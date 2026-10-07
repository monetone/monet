// Unit tests for the Replace Color helpers. Engine-free (node); the dialog + engine
// wiring are covered by the e2e suite + the Rust side. These pin the pure math: the
// fuzziness→radius mapping, the soft RGB-distance selection weight, and the
// weight-blended HSL shift (cross-checked against the verified Hue/Saturation).
import { describe, it, expect } from "vitest";
import {
  defaultReplaceColor,
  replaceColorEngineArgs,
  selectionRadius,
  selectionWeight,
  applyReplaceColor,
  FUZZINESS_MIN,
  FUZZINESS_MAX,
  MAX_RGB_DISTANCE,
  type ReplaceColorAdjust,
} from "./replaceColor";
import { applyHueSaturation } from "./hueSaturation";

const adj = (over: Partial<ReplaceColorAdjust> = {}): ReplaceColorAdjust => ({ ...defaultReplaceColor(), ...over });
const RED = { r: 255, g: 0, b: 0 };

describe("defaults, args & radius", () => {
  it("default is mild fuzziness, no shift", () => {
    expect(defaultReplaceColor()).toEqual({ fuzziness: 40, hue: 0, saturation: 0, lightness: 0 });
  });

  it("replaceColorEngineArgs = [fuzziness, hue, sat/100, light/100]", () => {
    expect(replaceColorEngineArgs(defaultReplaceColor())).toEqual([40, 0, 0, 0]);
    expect(replaceColorEngineArgs({ fuzziness: 60, hue: 120, saturation: 50, lightness: -20 })).toEqual([60, 120, 0.5, -0.2]);
  });

  it("selectionRadius = fuzz/200·√3, floored at 1e-3, no upper clamp (mirrors engine)", () => {
    expect(selectionRadius(0)).toBe(1e-3);
    expect(selectionRadius(FUZZINESS_MAX)).toBeCloseTo(MAX_RGB_DISTANCE, 9);
    expect(selectionRadius(100)).toBeCloseTo(MAX_RGB_DISTANCE / 2, 9);
    expect(selectionRadius(-5)).toBe(1e-3); // negative → floored
    expect(selectionRadius(400)).toBeCloseTo(2 * MAX_RGB_DISTANCE, 9); // engine keeps growing
    expect([FUZZINESS_MIN, FUZZINESS_MAX]).toEqual([0, 200]);
  });
});

describe("selectionWeight", () => {
  it("is 1 at the target and 0 well outside the radius", () => {
    expect(selectionWeight(RED, 200, 255, 0, 0)).toBeCloseTo(1, 9);
    // cyan is √3 from red — at the max radius weight is exactly 0
    expect(selectionWeight(RED, 200, 0, 255, 255)).toBeCloseTo(0, 9);
    // a smaller fuzziness excludes a moderately distant pixel entirely
    expect(selectionWeight(RED, 40, 0, 0, 255)).toBe(0);
  });

  it("decreases monotonically as a pixel moves away from the target", () => {
    let prev = 1.0001;
    for (let g = 0; g <= 255; g += 15) {
      const w = selectionWeight(RED, 200, 255, g, 0); // move red toward yellow
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
  });

  it("hits exactly 0.5 at half the radius", () => {
    // target black, fuzz 200 (radius √3); a pixel at distance √3/2 → weight 0.5.
    // (0.5,0.5,0.5) is at distance √(3·0.25)=√3/2 from black.
    expect(selectionWeight({ r: 0, g: 0, b: 0 }, 200, 128, 128, 128)).toBeCloseTo(0.5, 2);
  });
});

describe("applyReplaceColor", () => {
  it("at weight 1 (target == pixel) it equals a pure Hue/Saturation shift", () => {
    // dist 0 → weight 1 → the blend is the full HSL shift, identical to ⌘U.
    for (const [r, g, b] of [
      [255, 0, 0],
      [12, 200, 90],
      [70, 130, 180],
    ]) {
      const target = { r, g, b };
      const a = adj({ fuzziness: 100, hue: 120, saturation: 30, lightness: -10 });
      expect(applyReplaceColor(a, target, r, g, b)).toEqual(
        applyHueSaturation({ hue: 120, saturation: 30, lightness: -10 }, r, g, b),
      );
    }
  });

  it("rotates the target hue (red target+pixel, hue+120 → green)", () => {
    expect(applyReplaceColor(adj({ fuzziness: 100, hue: 120 }), RED, 255, 0, 0)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("leaves an unselected (far) pixel untouched", () => {
    // blue is far from the red target at fuzziness 40 → weight 0 → unchanged.
    expect(applyReplaceColor(adj({ fuzziness: 40, hue: 120, saturation: 100 }), RED, 0, 0, 255)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("an identity shift (hue=sat=light=0) is a no-op even where fully selected", () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [128, 128, 128],
      [40, 200, 90],
    ]) {
      expect(applyReplaceColor(adj({ fuzziness: 200 }), { r, g, b }, r, g, b)).toEqual({ r, g, b });
    }
  });

  it("a partial weight blends between the original and the full shift", () => {
    // target slightly off the pixel so 0 < weight < 1; result sits between orig and
    // the full Hue/Saturation shift on the same channel.
    const a = adj({ fuzziness: 60, hue: 0, saturation: 0, lightness: 100 }); // lighten toward white
    const target = { r: 200, g: 60, b: 60 };
    const px: [number, number, number] = [180, 70, 70]; // near but not equal to target
    const w = selectionWeight(target, 60, ...px);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
    const out = applyReplaceColor(a, target, ...px);
    const full = applyHueSaturation({ hue: 0, saturation: 0, lightness: 100 }, ...px); // → white-ish
    // partial result is brighter than the original but not as bright as the full
    // shift — on every channel.
    const chans = [["r", 0], ["g", 1], ["b", 2]] as const;
    for (const [ch, i] of chans) {
      expect(out[ch]).toBeGreaterThan(px[i]);
      expect(out[ch]).toBeLessThanOrEqual(full[ch]);
    }
  });

  it("fuzziness 0 selects essentially only the exact target", () => {
    const a = adj({ fuzziness: 0, hue: 180 });
    expect(applyReplaceColor(a, RED, 255, 0, 0)).not.toEqual({ r: 255, g: 0, b: 0 }); // exact target shifts
    expect(applyReplaceColor(a, RED, 250, 5, 5)).toEqual({ r: 250, g: 5, b: 5 }); // a hair off → untouched
  });

  it("is deterministic", () => {
    const a = adj({ fuzziness: 80, hue: 40, saturation: 25 });
    expect(applyReplaceColor(a, RED, 200, 30, 30)).toEqual(applyReplaceColor(a, RED, 200, 30, 30));
  });
});

// ── Several fixtures swept for in-gamut + determinism ───────────────────────
const FIXTURES: { name: string; adj: ReplaceColorAdjust; target: Rgbish }[] = [
  { name: "red→green swap", adj: { fuzziness: 80, hue: 120, saturation: 0, lightness: 0 }, target: { r: 255, g: 0, b: 0 } },
  { name: "sky desaturate", adj: { fuzziness: 120, hue: 0, saturation: -80, lightness: 10 }, target: { r: 90, g: 140, b: 210 } },
  { name: "tight selection recolor", adj: { fuzziness: 20, hue: -60, saturation: 40, lightness: -20 }, target: { r: 200, g: 120, b: 40 } },
  { name: "broad lighten", adj: { fuzziness: 200, hue: 0, saturation: 0, lightness: 50 }, target: { r: 128, g: 128, b: 128 } },
];
interface Rgbish { r: number; g: number; b: number; }

describe.each(FIXTURES)("fixture: $name", ({ adj: a, target }) => {
  it("produces finite, in-gamut, deterministic output across a pixel set", () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [64, 128, 192],
      [255, 255, 255],
      [220, 30, 70],
      [128, 128, 128],
      [200, 120, 40],
    ];
    for (const [r, g, b] of pixels) {
      const out = applyReplaceColor(a, target, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applyReplaceColor(a, target, r, g, b)).toEqual(out);
    }
  });
});
