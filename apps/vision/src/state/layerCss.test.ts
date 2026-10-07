// Layer effects are a MULTISET (stacked shadows, layered strokes), but Copy CSS
// read the whole-type getter — instance 0 only — so a layer with two drop
// shadows pasted a single `box-shadow`. CSS takes a comma-separated list, so the
// stacked style maps onto it directly. The Layers-panel effect badge had the
// same whole-type read; that one is asserted in stackedEffectRowBadge.test.
import { describe, expect, it } from "vitest";
import { boxShadowTerm, boxShadowValue } from "./layerCss";

/** A drop-shadow param vector: [enabled, _, opacity, r, g, b, angle, distance, _, size]. */
const shadow = (patch: Record<number, number> = {}): number[] => {
  const p = [1, 0, 0.5, 0, 0, 0, 90, 10, 0, 4];
  for (const [i, v] of Object.entries(patch)) p[Number(i)] = v as number;
  return p;
};

describe("boxShadowTerm", () => {
  // (#131) The expectations below are the ENGINE's, read off offset_px in
  // raster/effects.rs (dx = -cos(a)·d, dy = +sin(a)·d, screen y down) — the
  // previous ones pinned the inverted offsets this module used to emit.
  it("converts angle + distance to the engine's screen-space offset", () => {
    // 90° light is directly above; the shadow falls AWAY from the light, i.e.
    // straight down: dy = +sin(90°)·10 = +10.
    expect(boxShadowTerm(shadow())).toBe("0px 10px 4px rgba(0, 0, 0, 0.50)");
    // 0° light is to the right → the shadow is cast to the left.
    expect(boxShadowTerm(shadow({ 6: 0 }))).toBe("-10px 0px 4px rgba(0, 0, 0, 0.50)");
    // The FX_DEFS drop-shadow default (angle 120, distance 10) — the engine
    // shifts the matte by (+5, +9), i.e. right and DOWN.
    expect(boxShadowTerm(shadow({ 6: 120 }))).toBe("5px 9px 4px rgba(0, 0, 0, 0.50)");
  });

  it("drops a disabled or malformed instance", () => {
    expect(boxShadowTerm(shadow({ 0: 0 })), "disabled").toBeNull();
    expect(boxShadowTerm([1, 0, 0.5]), "too short to read").toBeNull();
  });
});

describe("boxShadowValue", () => {
  it("emits EVERY enabled instance, in stack order", () => {
    const value = boxShadowValue([shadow({ 7: 10 }), shadow({ 7: 20, 3: 1 })]);
    expect(value).toBe("0px 10px 4px rgba(0, 0, 0, 0.50), 0px 20px 4px rgba(255, 0, 0, 0.50)");
    // The regression this guards: reading instance 0 alone yields one term.
    // Counting `rgba(` rather than splitting on ", " — the colour itself
    // contains ", " and would inflate the count.
    expect((value!.match(/rgba\(/g) ?? []).length, "two shadows, two terms").toBe(2);
  });

  it("skips disabled instances but keeps the ones still painting", () => {
    // The first shadow is off and a later one is on — the case a whole-type
    // read gets exactly backwards.
    expect(boxShadowValue([shadow({ 0: 0 }), shadow({ 7: 20 })]))
      .toBe("0px 20px 4px rgba(0, 0, 0, 0.50)");
  });

  it("is null when nothing is enabled, so no box-shadow line is written", () => {
    expect(boxShadowValue([])).toBeNull();
    expect(boxShadowValue([shadow({ 0: 0 })])).toBeNull();
  });
});
