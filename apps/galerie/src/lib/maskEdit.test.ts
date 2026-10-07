import {
  computeMaskCoverage,
  createMask,
  createMaskGraph,
  type AiComponent,
  type BrushComponent,
} from "@monet-ui/monet-photo";
import { describe, expect, it } from "vitest";

import {
  needsBaseImage,
  newAiSubjectMask,
  newBrushMask,
  newComponent,
  newGradientMask,
  newRangeMask,
  renderableMasks,
  strokeDab,
  type BrushSettings,
  type ComponentKind,
} from "./maskEdit";

describe("newGradientMask", () => {
  it("seeds a linear mask with a top-down axis + neutral adjustments", () => {
    const m = newGradientMask("linearGradient", "m1", "Linear 1");
    expect(m.id).toBe("m1");
    expect(m.name).toBe("Linear 1");
    expect(m.enabled).toBe(true);
    expect(m.components).toHaveLength(1);
    const c = m.components[0];
    expect(c.kind).toBe("linearGradient");
    expect(c.id).toBe("m1-c");
    expect(m.adjustments.exposure).toBe(0);
  });

  it("seeds a radial mask with a centered feathered ellipse", () => {
    const m = newGradientMask("radialGradient", "m2", "Radial 1");
    const c = m.components[0];
    expect(c.kind).toBe("radialGradient");
    if (c.kind === "radialGradient") {
      expect(c.cx).toBe(0.5);
      expect(c.feather).toBeGreaterThan(0);
    }
  });
});

describe("newRangeMask", () => {
  it("seeds a color range with no samples and mid refine", () => {
    const m = newRangeMask("rangeColor", "r1", "Color 1");
    const c = m.components[0];
    expect(c.kind).toBe("rangeColor");
    if (c.kind === "rangeColor") {
      expect(c.samples).toEqual([]);
      expect(c.refine).toBeGreaterThan(0);
    }
  });
  it("seeds a luminance range with a valid midtones band", () => {
    const m = newRangeMask("rangeLuminance", "r2", "Luma 1");
    const c = m.components[0];
    expect(c.kind).toBe("rangeLuminance");
    if (c.kind === "rangeLuminance") {
      expect(c.min).toBeLessThan(c.max);
      expect(c.smoothness).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("renderableMasks", () => {
  it("keeps enabled gradient/range/brush masks, drops disabled + AI", () => {
    const graph = createMaskGraph();
    const lin = newGradientMask("linearGradient", "a", "A");
    const off = newGradientMask("radialGradient", "b", "B");
    off.enabled = false;
    const color = newRangeMask("rangeColor", "c", "C");
    const brush = newGradientMask("linearGradient", "d", "D");
    const brushComp: BrushComponent = {
      kind: "brush",
      id: "d-c",
      combine: "add",
      invert: false,
      dabs: [],
      autoMask: false,
    };
    brush.components = [brushComp]; // brush IS renderable now
    const ai = newGradientMask("linearGradient", "e", "E");
    const aiComp: AiComponent = {
      kind: "aiSubject",
      id: "e-c",
      combine: "add",
      invert: false,
      model: "u2netp",
      cacheId: null,
    };
    ai.components = [aiComp]; // AI awaits its model → not renderable
    graph.masks.push(lin, off, color, brush, ai);
    const out = renderableMasks(graph);
    expect(out.map((m) => m.id)).toEqual(["a", "c", "d"]);
  });
});

describe("newBrushMask", () => {
  it("seeds an empty brush component", () => {
    const m = newBrushMask("b1", "Brush 1");
    const c = m.components[0];
    expect(c.kind).toBe("brush");
    if (c.kind === "brush") expect(c.dabs).toEqual([]);
  });
});

describe("newAiSubjectMask", () => {
  it("seeds a u2netp AI component referencing its coverage cacheId", () => {
    const m = newAiSubjectMask("a1", "Subject 1", "cache-xyz");
    const c = m.components[0];
    expect(c.kind).toBe("aiSubject");
    if (c.kind === "aiSubject") {
      expect(c.model).toBe("u2netp");
      expect(c.cacheId).toBe("cache-xyz");
    }
  });
});

describe("strokeDab", () => {
  const s: BrushSettings = { radius: 0.1, flow: 0.5, density: 1, erase: false };
  it("stamps the first dab with the brush settings", () => {
    const dab = strokeDab(null, 0.3, 0.4, s);
    expect(dab).toEqual({ x: 0.3, y: 0.4, radius: 0.1, flow: 0.5, density: 1, erase: false });
  });
  it("skips a dab too close to the last (< quarter radius)", () => {
    expect(strokeDab({ x: 0.3, y: 0.4 }, 0.31, 0.4, s)).toBeNull(); // 0.01 < 0.025
  });
  it("stamps once the pointer moves past quarter-radius spacing", () => {
    expect(strokeDab({ x: 0.3, y: 0.4 }, 0.34, 0.4, s)).not.toBeNull(); // 0.04 ≥ 0.025
  });
  it("carries the erase flag through", () => {
    expect(strokeDab(null, 0.1, 0.1, { ...s, erase: true })?.erase).toBe(true);
  });
});

describe("newComponent", () => {
  const KINDS: ComponentKind[] = [
    "linearGradient",
    "radialGradient",
    "rangeColor",
    "rangeLuminance",
    "brush",
  ];
  it("stamps kind, id, combine and un-inverted defaults for each kind", () => {
    for (const kind of KINDS) {
      const c = newComponent(kind, `${kind}-x`, "subtract");
      expect(c.kind).toBe(kind);
      expect(c.id).toBe(`${kind}-x`);
      expect(c.combine).toBe("subtract");
      expect(c.invert).toBe(false);
    }
  });
  it("seeds a feathered radial and an empty brush", () => {
    const r = newComponent("radialGradient", "r", "add");
    if (r.kind === "radialGradient") expect(r.feather).toBeGreaterThan(0);
    const b = newComponent("brush", "b", "add");
    if (b.kind === "brush") {
      expect(b.dabs).toEqual([]);
      expect(b.autoMask).toBe(false);
    }
  });
});

describe("stacked components fold through computeMaskCoverage", () => {
  it("a subtracted brush carves coverage out of a radial base", () => {
    // Radial base (centered, feather 0.5) fully covers the middle; a central
    // 'subtract' brush should punch a hole there while leaving the mid-radius ring.
    const base = newComponent("radialGradient", "base", "add");
    const mask = createMask("m", "M", base);
    const brush = newComponent("brush", "b", "subtract");
    if (brush.kind !== "brush") throw new Error("expected brush");
    brush.dabs = [{ x: 0.5, y: 0.5, radius: 0.15, flow: 1, density: 1, erase: false }];
    const stacked = { ...mask, components: [base, brush] };

    const W = 40;
    const H = 40;
    const at = (cov: Float32Array, nx: number, ny: number) =>
      cov[Math.round(ny * (H - 1)) * W + Math.round(nx * (W - 1))];

    const stackedCov = computeMaskCoverage(stacked, W, H);
    const baseCov = computeMaskCoverage(mask, W, H);

    // Base alone: full coverage at the center.
    expect(at(baseCov, 0.5, 0.5)).toBeGreaterThan(0.9);
    // Stacked: the brush subtracts most of the center...
    expect(at(stackedCov, 0.5, 0.5)).toBeLessThan(0.2);
    // ...but the ring outside the brush (still inside the radial) survives.
    const ring = at(stackedCov, 0.5, 0.72);
    expect(ring).toBeGreaterThan(0.3);
    expect(ring).toBeGreaterThan(at(stackedCov, 0.5, 0.5));
  });

  it("an intersect luminance range narrows a linear base to the overlap", () => {
    // 4px-wide strip: left half dark, right half bright. A linear base covers
    // right→left; an 'intersect' bright-luma range keeps only where both hold.
    const base = newComponent("linearGradient", "base", "add");
    if (base.kind !== "linearGradient") throw new Error("expected linear");
    // Horizontal axis: coverage rises left(0)→right(1).
    Object.assign(base, { x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
    const luma = newComponent("rangeLuminance", "l", "intersect");
    if (luma.kind !== "rangeLuminance") throw new Error("expected luma");
    Object.assign(luma, { min: 0.6, max: 1, smoothness: 0 });
    const mask = { ...createMask("m", "M", base), components: [base, luma] };

    const W = 4;
    const H = 1;
    const src = new Uint8ClampedArray(W * H * 4);
    for (let x = 0; x < W; x++) {
      const v = x < W / 2 ? 20 : 240; // left dark, right bright
      src.set([v, v, v, 255], x * 4);
    }
    const cov = computeMaskCoverage(mask, W, H, { pixels: src, width: W, height: H });
    // Rightmost bright pixel: high linear coverage AND in the luma band → kept.
    expect(cov[3]).toBeGreaterThan(0.5);
    // Leftmost dark pixel: fails the luma band → intersect zeroes it.
    expect(cov[0]).toBe(0);
  });
});

describe("needsBaseImage", () => {
  it("is true only when a range component is present", () => {
    expect(needsBaseImage([newGradientMask("linearGradient", "a", "A")])).toBe(false);
    expect(needsBaseImage([newRangeMask("rangeColor", "c", "C")])).toBe(true);
    expect(needsBaseImage([newRangeMask("rangeLuminance", "l", "L")])).toBe(true);
  });
});
