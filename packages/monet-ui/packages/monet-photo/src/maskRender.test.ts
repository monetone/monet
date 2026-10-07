import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "./developRecipe";
import {
  createLocalAdjustments,
  createMask,
  type BrushComponent,
  type ColorRangeComponent,
  type LinearGradientComponent,
  type LuminanceRangeComponent,
  type RadialGradientComponent,
} from "./maskGraph";
import {
  blendMasked,
  computeMaskCoverage,
  foldLocalAdjustments,
  type MaskRenderSource,
} from "./maskRender";

const linear = (over: Partial<LinearGradientComponent> = {}): LinearGradientComponent => ({
  kind: "linearGradient",
  id: "l",
  combine: "add",
  invert: false,
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 0,
  ...over,
});

const radial = (over: Partial<RadialGradientComponent> = {}): RadialGradientComponent => ({
  kind: "radialGradient",
  id: "r",
  combine: "add",
  invert: false,
  cx: 0.5,
  cy: 0.5,
  rx: 0.5,
  ry: 0.5,
  angle: 0,
  feather: 0,
  ...over,
});

const brush = (over: Partial<BrushComponent> = {}): BrushComponent => ({
  kind: "brush",
  id: "b",
  combine: "add",
  invert: false,
  dabs: [],
  autoMask: false,
  ...over,
});

const rangeColor = (over: Partial<ColorRangeComponent> = {}): ColorRangeComponent => ({
  kind: "rangeColor",
  id: "rc",
  combine: "add",
  invert: false,
  samples: [],
  refine: 0,
  ...over,
});

const rangeLuminance = (over: Partial<LuminanceRangeComponent> = {}): LuminanceRangeComponent => ({
  kind: "rangeLuminance",
  id: "rl",
  combine: "add",
  invert: false,
  min: 0,
  max: 1,
  smoothness: 0,
  ...over,
});

/** Build a MaskRenderSource from a flat list of [r,g,b] pixels (row-major, alpha=255). */
function makeBase(width: number, height: number, pixels: Array<[number, number, number]>): MaskRenderSource {
  const buf = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b], i) => {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  });
  return { pixels: buf, width, height };
}

describe("computeMaskCoverage — linear gradient", () => {
  it("ramps left→right along its axis, clamped 0 and 1", () => {
    const m = createMask("m", "Grad", linear({ x1: 0, y1: 0, x2: 1, y2: 0 }));
    const cov = computeMaskCoverage(m, 5, 1);
    // x/(w-1) = 0,.25,.5,.75,1 → coverage identical
    expect(Array.from(cov)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("degenerate axis (start==end) covers nothing", () => {
    const m = createMask("m", "Grad", linear({ x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 }));
    const cov = computeMaskCoverage(m, 4, 1);
    expect(Array.from(cov).every((v) => v === 0)).toBe(true);
  });

  it("opacity scales the whole field", () => {
    const m = createMask("m", "Grad", linear());
    m.opacity = 0.5;
    const cov = computeMaskCoverage(m, 3, 1);
    expect(Array.from(cov)).toEqual([0, 0.25, 0.5]);
  });

  it("whole-mask inversion flips coverage", () => {
    const m = createMask("m", "Grad", linear());
    m.inverted = true;
    const cov = computeMaskCoverage(m, 3, 1);
    expect(Array.from(cov)).toEqual([1, 0.5, 0]);
  });
});

describe("computeMaskCoverage — radial gradient", () => {
  it("full at center, zero outside the ellipse (hard edge, feather 0)", () => {
    const m = createMask("m", "Rad", radial());
    const cov = computeMaskCoverage(m, 3, 3);
    // center pixel (1,1) is inside; the four corners sit outside the r=0.5 circle
    expect(cov[1 * 3 + 1]).toBe(1);
    expect(cov[0]).toBe(0); // corner (0,0), d = sqrt(0.5)/0.5 ≈ 1.41 > 1
    expect(cov[2 * 3 + 2]).toBe(0);
  });

  it("feather produces a ramp between inner and edge", () => {
    // rx=ry=1 so the edge is far; feather 1 → inner=0, ramp is 1 - d over 0..1.
    const m = createMask("m", "Rad", radial({ cx: 0, cy: 0, rx: 1, ry: 1, feather: 1 }));
    const cov = computeMaskCoverage(m, 3, 1); // y=0; x → nx 0,.5,1, d = nx
    // coverage = 1 - d
    expect(cov[0]).toBeCloseTo(1);
    expect(cov[1]).toBeCloseTo(0.5);
    expect(cov[2]).toBeCloseTo(0);
  });
});

describe("computeMaskCoverage — component combine", () => {
  it("subtract erases coverage where the second component is active", () => {
    const m = createMask("m", "Grad", linear({ x1: 0, x2: 1 })); // ramp 0→1
    // subtract a full-coverage linear (whole image = 1) → acc*(1-1)=0 everywhere
    m.components.push(linear({ id: "s", combine: "subtract", x1: 0, y1: 0, x2: 0.0001, y2: 0 }));
    const cov = computeMaskCoverage(m, 4, 1);
    // second comp: t = nx / 0.0001, clamps to 1 for nx>0 → subtract to 0; nx=0 → 0 subtracted from 0
    expect(Array.from(cov)).toEqual([0, 0, 0, 0]);
  });

  it("intersect takes the min of the two coverages", () => {
    const m = createMask("m", "A", linear({ x1: 0, x2: 1 })); // 0→1 left-right
    m.components.push(linear({ id: "b", combine: "intersect", x1: 1, y1: 0, x2: 0, y2: 0 })); // 1→0
    const cov = computeMaskCoverage(m, 5, 1);
    // min(t, 1-t): 0,.25,.5,.25,0
    expect(Array.from(cov)).toEqual([0, 0.25, 0.5, 0.25, 0]);
  });

  it("component invert flips just that component before combine", () => {
    const base = linear({ x1: 0, x2: 1, invert: true }); // 1→0
    const m = createMask("m", "A", base);
    const cov = computeMaskCoverage(m, 3, 1);
    expect(Array.from(cov)).toEqual([1, 0.5, 0]);
  });
});

describe("computeMaskCoverage — brush", () => {
  it("a single dab is full coverage at its center and 0 beyond its radius", () => {
    const m = createMask(
      "m",
      "Brush",
      brush({ dabs: [{ x: 0.5, y: 0.5, radius: 0.5, flow: 1, density: 1, erase: false }] }),
    );
    const cov = computeMaskCoverage(m, 5, 5);
    expect(cov[2 * 5 + 2]).toBe(1); // center pixel
    expect(cov[0]).toBe(0); // corner: distance 3.5 > radius 2.5px, clamped to 0
  });

  it("radius is normalized to min(width,height), not width alone", () => {
    const m = createMask(
      "m",
      "Brush",
      brush({ dabs: [{ x: 0.5, y: 0.5, radius: 0.5, flow: 1, density: 1, erase: false }] }),
    );
    // width=11,height=5 → radius is 0.5*min(11,5)=2.5px. Pixel (8,2) sits 3.3px
    // from the dab center along x — outside a radius keyed to min(w,h), but
    // well inside one wrongly keyed to width (5.5px).
    const cov = computeMaskCoverage(m, 11, 5);
    expect(cov[2 * 11 + 8]).toBe(0);
  });

  it("repeated paint dabs accumulate by flow, capped by density", () => {
    const dab = { x: 0, y: 0, radius: 1, flow: 0.3, density: 0.7, erase: false };
    const m = createMask("m", "Brush", brush({ dabs: [dab, dab, dab] }));
    const cov = computeMaskCoverage(m, 1, 1); // single pixel, distance 0 to every dab
    expect(cov[0]).toBeCloseTo(0.7, 5); // 0.3+0.3+0.3=0.9, capped at density 0.7
  });

  it("an erase dab subtracts accumulated coverage", () => {
    const paint = { x: 0, y: 0, radius: 1, flow: 0.3, density: 0.7, erase: false };
    const erase = { x: 0, y: 0, radius: 1, flow: 0.5, density: 0, erase: true };
    const m = createMask("m", "Brush", brush({ dabs: [paint, paint, paint, erase] }));
    const cov = computeMaskCoverage(m, 1, 1);
    expect(cov[0]).toBeCloseTo(0.2, 5); // 0.7 - 0.5
  });

  it("feather 0 hardens the edge; absent feather keeps the pre-feather falloff", () => {
    const dab = { x: 0, y: 0.5, radius: 1, flow: 1, density: 1, erase: false };
    // 3x3, dab centred mid-left, radius 3px. Pixel (1,1) sits at d=0.5:
    // absent feather (=1) smoothsteps the whole radius → 0.5 there;
    // feather 0 (inner=1) is a hard disc → full coverage.
    const soft = computeMaskCoverage(createMask("m", "B", brush({ dabs: [dab] })), 3, 3);
    expect(soft[1 * 3 + 1]).toBeCloseTo(0.5, 5);
    const hard = computeMaskCoverage(
      createMask("m", "B", brush({ dabs: [dab], feather: 0 })),
      3,
      3,
    );
    expect(hard[1 * 3 + 1]).toBe(1);
  });

  it("autoMask restricts a dab to pixels matching the color under its center", () => {
    const dab = { x: 0, y: 0, radius: 3, flow: 1, density: 1, erase: false };
    // 2x1 base: dab center sits on a red pixel; the far pixel is blue (distance
    // well past AUTO_MASK_TOLERANCE). Feather 0 → hard disc, so without
    // autoMask the oversized dab fully covers both pixels.
    const base = makeBase(2, 1, [
      [255, 0, 0],
      [0, 0, 255],
    ]);
    const plain = computeMaskCoverage(
      createMask("m", "B", brush({ dabs: [dab], feather: 0 })),
      2,
      1,
      base,
    );
    expect(plain[1]).toBe(1);
    const auto = computeMaskCoverage(
      createMask("m", "B", brush({ dabs: [dab], feather: 0, autoMask: true })),
      2,
      1,
      base,
    );
    expect(auto[0]).toBe(1); // same color as the sample → kept
    expect(auto[1]).toBe(0); // dissimilar color → constrained out
  });
});

describe("computeMaskCoverage — range color", () => {
  it("is 1 exactly at a sample color and 0 far from it", () => {
    const base = makeBase(2, 1, [
      [128, 128, 128], // matches the sample exactly
      [0, 0, 0], // far from it
    ]);
    const m = createMask(
      "m",
      "RC",
      rangeColor({ samples: [{ r: 128 / 255, g: 128 / 255, b: 128 / 255 }], refine: 0.3 }),
    );
    const cov = computeMaskCoverage(m, 2, 1, base);
    expect(cov[0]).toBeCloseTo(1, 5);
    expect(cov[1]).toBe(0);
  });

  it("empty samples yield zero coverage", () => {
    const base = makeBase(1, 1, [[128, 128, 128]]);
    const m = createMask("m", "RC", rangeColor({ samples: [] }));
    expect(computeMaskCoverage(m, 1, 1, base)[0]).toBe(0);
  });

  it("yields zero coverage when no base image is given", () => {
    const m = createMask("m", "RC", rangeColor({ samples: [{ r: 0.5, g: 0.5, b: 0.5 }] }));
    expect(computeMaskCoverage(m, 1, 1)[0]).toBe(0);
  });

  it("larger refine widens the selection at a fixed distance", () => {
    const base = makeBase(1, 1, [[255, 255, 255]]);
    const sample = { r: 0.9, g: 1, b: 1 }; // distance 0.1 from white
    const cov0 = computeMaskCoverage(createMask("m", "RC", rangeColor({ samples: [sample], refine: 0 })), 1, 1, base)[0];
    const covHalf = computeMaskCoverage(createMask("m", "RC", rangeColor({ samples: [sample], refine: 0.5 })), 1, 1, base)[0];
    const cov1 = computeMaskCoverage(createMask("m", "RC", rangeColor({ samples: [sample], refine: 1 })), 1, 1, base)[0];
    expect(cov0).toBe(0); // tolerance 0.08 < distance 0.1
    expect(cov1).toBeCloseTo(0.896, 3); // tolerance 0.5
    expect(cov0).toBeLessThan(covHalf);
    expect(covHalf).toBeLessThan(cov1);
  });

  it("throws when the base image size doesn't match the coverage size", () => {
    const base = makeBase(3, 4, Array.from({ length: 12 }, () => [0, 0, 0]));
    const m = createMask("m", "RC", rangeColor({ samples: [{ r: 0, g: 0, b: 0 }] }));
    expect(() => computeMaskCoverage(m, 4, 4, base)).toThrow();
  });
});

describe("computeMaskCoverage — range luminance", () => {
  it("is full coverage inside the band", () => {
    const base = makeBase(1, 1, [[128, 128, 128]]); // luma ≈ 0.502
    const m = createMask("m", "RL", rangeLuminance({ min: 0.4, max: 0.6, smoothness: 0 }));
    expect(computeMaskCoverage(m, 1, 1, base)[0]).toBe(1);
  });

  it("is zero outside the band with smoothness 0 (hard edge)", () => {
    const base = makeBase(1, 1, [[255, 255, 255]]); // luma 1.0
    const m = createMask("m", "RL", rangeLuminance({ min: 0.4, max: 0.6, smoothness: 0 }));
    expect(computeMaskCoverage(m, 1, 1, base)[0]).toBe(0);
  });

  it("feathers outside the band when smoothness > 0", () => {
    const base = makeBase(1, 1, [[204, 204, 204]]); // luma 0.8 exactly (204/255)
    const m = createMask("m", "RL", rangeLuminance({ min: 0.4, max: 0.6, smoothness: 1 }));
    // d = 0.8-0.6 = 0.2, edge = 0.5 → t = 1-0.2/0.5 = 0.6 → smoothstep(0.6) = 0.648
    const cov = computeMaskCoverage(m, 1, 1, base)[0];
    expect(cov).toBeCloseTo(0.648, 3);
    expect(cov).toBeGreaterThan(0);
    expect(cov).toBeLessThan(1);
  });

  it("min > max defensively yields zero coverage", () => {
    const base = makeBase(1, 1, [[128, 128, 128]]);
    const m = createMask("m", "RL", rangeLuminance({ min: 0.6, max: 0.4, smoothness: 1 }));
    expect(computeMaskCoverage(m, 1, 1, base)[0]).toBe(0);
  });

  it("yields zero coverage when no base image is given", () => {
    const m = createMask("m", "RL", rangeLuminance({ min: 0.4, max: 0.6 }));
    expect(computeMaskCoverage(m, 1, 1)[0]).toBe(0);
  });
});

describe("computeMaskCoverage — range masks combine with geometry masks", () => {
  it("a rangeLuminance intersect zeroes out a linearGradient where luma is out of band", () => {
    // x=0,1,2 gray (in-band); x=3,4 white (out of band, hard edge)
    const base = makeBase(5, 1, [
      [128, 128, 128],
      [128, 128, 128],
      [128, 128, 128],
      [255, 255, 255],
      [255, 255, 255],
    ]);
    const m = createMask("m", "Combo", linear({ x1: 0, y1: 0, x2: 1, y2: 0 })); // ramp 0,.25,.5,.75,1
    m.components.push(rangeLuminance({ min: 0.4, max: 0.6, smoothness: 0, combine: "intersect" }));
    const cov = computeMaskCoverage(m, 5, 1, base);
    expect(Array.from(cov)).toEqual([0, 0.25, 0.5, 0, 0]);
  });

  it("component invert flips a range component's coverage before combine", () => {
    const base = makeBase(1, 1, [[128, 128, 128]]); // in-band → coverage 1
    const m = createMask("m", "RL", rangeLuminance({ min: 0.4, max: 0.6, invert: true }));
    expect(computeMaskCoverage(m, 1, 1, base)[0]).toBe(0);
  });
});

describe("foldLocalAdjustments", () => {
  it("adds local basic offsets onto the recipe's basic values", () => {
    const r = createDefaultRecipe();
    r.basic.exposure = 0.4; // +10 EV-domain
    const adj = { ...createLocalAdjustments(), exposure: 0.8, contrast: 0.2, texture: 0.1 };
    const folded = foldLocalAdjustments(r, adj);
    expect(folded.basic.exposure).toBeCloseTo(1.2);
    expect(folded.basic.contrast).toBeCloseTo(0.2);
    expect(folded.basic.texture).toBeCloseTo(0.1);
    // untouched fields keep their value; original recipe is not mutated
    expect(folded.basic.tint).toBe(0);
    expect(r.basic.exposure).toBe(0.4);
  });

  it("routes sharpness/noise/defringe to detail+optics", () => {
    const r = createDefaultRecipe();
    const adj = { ...createLocalAdjustments(), sharpness: 0.3, noise: 0.5, defringe: 0.2 };
    const folded = foldLocalAdjustments(r, adj);
    expect(folded.detail.sharpenAmount).toBeCloseTo(0.3);
    expect(folded.detail.nrLuminance).toBeCloseTo(0.5);
    expect(folded.optics.defringePurpleAmount).toBeCloseTo(0.2);
  });
});

describe("blendMasked", () => {
  it("mixes rgb by coverage, leaves alpha, mutates base in place", () => {
    const base = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const masked = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255]);
    const cov = new Float32Array([0, 0.5, 1]);
    blendMasked(base, masked, cov);
    expect(Array.from(base.slice(0, 3))).toEqual([0, 0, 0]); // a=0 untouched
    expect(Array.from(base.slice(4, 7))).toEqual([50, 50, 50]); // a=.5 midpoint
    expect(Array.from(base.slice(8, 11))).toEqual([100, 100, 100]); // a=1 full replace
    expect(base[3]).toBe(255); // alpha preserved
  });
});
