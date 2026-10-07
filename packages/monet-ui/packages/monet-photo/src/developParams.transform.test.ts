// v4 advanced tail (GAL-DEV-07): Transform's Aspect / Scale / X-Y Offset +
// Constrain Crop ride a trailing 5-float block after the v3 payload. The
// invariants: a recipe without transform extras keeps its exact prior bytes
// (1086 / v1 / v3), and the emitted block always sits inside the engine
// parser's accepted ranges so a UI value can never atomically reject the tail.

import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "./developRecipe";
import { recipeToParams } from "./developParams";

// prefix + v1 block (27) + curve source (24) + socket count (1) + transform (5)
const V4_LEN = 1086 + 27 + 24 + 1 + 5;

describe("v4 transform tail", () => {
  it("keystone-only recipes stay 1086 floats (zero regression)", () => {
    const r = createDefaultRecipe();
    r.transform.vertical = 0.3; // prefix float [1083] — no tail needed
    r.transform.rotate = -0.1;
    const p = recipeToParams(r);
    expect(p.length).toBe(1086);
    expect(p[1083]).toBeCloseTo(0.3, 5);
  });

  it("constrainCrop without any active geometry stays 1086 (checkbox is a no-op)", () => {
    const r = createDefaultRecipe();
    r.transform.constrainCrop = true;
    expect(recipeToParams(r).length).toBe(1086);
  });

  it("scale/offset emit a v4 tail carrying the transform block", () => {
    const r = createDefaultRecipe();
    r.transform.scale = 1.2;
    r.transform.xOffset = -0.5;
    const p = recipeToParams(r);
    expect(p.length).toBe(V4_LEN);
    expect(p[1086]).toBe(22026); // magic
    expect(p[1087]).toBe(4); // version
    const block = Array.from(p.slice(p.length - 5));
    expect(block[0]).toBe(0); // aspect
    expect(block[1]).toBeCloseTo(1.2, 5); // scale
    expect(block[2]).toBeCloseTo(-0.5, 5); // xOffset
    expect(block[3]).toBe(0); // yOffset
    expect(block[4]).toBe(0); // constrainCrop
  });

  it("keystone + constrainCrop emits v4 with the flag set", () => {
    const r = createDefaultRecipe();
    r.transform.rotate = 0.2;
    r.transform.constrainCrop = true;
    const p = recipeToParams(r);
    expect(p.length).toBe(V4_LEN);
    expect(p[1087]).toBe(4);
    expect(p[1085]).toBeCloseTo(0.2, 5); // rotate still rides the prefix
    expect(p[p.length - 1]).toBe(1); // constrainCrop
  });

  it("hostile out-of-range extras are pre-clamped into the engine parser's ranges", () => {
    const r = createDefaultRecipe();
    r.transform.scale = 50; // engine parser accepts 0.25..4
    r.transform.xOffset = -7; // -1..1
    const p = recipeToParams(r);
    expect(p[p.length - 4]).toBe(4);
    expect(p[p.length - 3]).toBe(-1);
  });

  it("v4 rides on top of the point-color v3 payload (sockets still emitted)", () => {
    const r = createDefaultRecipe();
    r.pointColor.samples.push({ srcHue: 120, srcSat: 0.5, srcLum: 0.5, hue: 0.1, sat: 0, lum: 0, range: 0.5 });
    r.transform.yOffset = 0.25;
    const p = recipeToParams(r);
    expect(p.length).toBe(1086 + 27 + 24 + 1 + 7 + 5);
    expect(p[1087]).toBe(4);
    expect(p[1086 + 27 + 24]).toBe(1); // socket count precedes the transform block
    expect(p[p.length - 2]).toBeCloseTo(0.25, 5); // yOffset
  });

  it("point color without transform extras keeps emitting plain v3", () => {
    const r = createDefaultRecipe();
    r.pointColor.samples.push({ srcHue: 120, srcSat: 0.5, srcLum: 0.5, hue: 0.1, sat: 0, lum: 0, range: 0.5 });
    const p = recipeToParams(r);
    expect(p[1087]).toBe(3);
    expect(p.length).toBe(1086 + 27 + 24 + 1 + 7);
  });
});
