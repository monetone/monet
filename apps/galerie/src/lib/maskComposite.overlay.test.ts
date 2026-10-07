// GAL-MASK-01: the coverage overlay's data path. compositeMasks publishes the
// frame it composited (MaskOverlay repaints from it), maskCoverage yields the
// field the tint shows, tintCoverage rasterizes it.

import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { describe, expect, it } from "vitest";

import {
  compositeMasks,
  getOverlayFrame,
  maskCoverage,
  onOverlayFrame,
  tintCoverage,
  type RenderedFrame,
} from "./maskComposite";
import { newAiSubjectMask, newGradientMask, newRangeMask } from "./maskEdit";

const W = 8;
const H = 4;

function frame(value: number): RenderedFrame {
  const rgba = new Uint8Array(W * H * 4);
  rgba.fill(value);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { rgba, width: W, height: H };
}

function withMask(mask: DevelopRecipeV2["masks"]["masks"][number]): DevelopRecipeV2 {
  const recipe = createDefaultRecipe();
  return { ...recipe, masks: { masks: [mask] } };
}

/** A left→right linear gradient mask (neutral adjustments — authoring state). */
function gradientMask() {
  const mask = newGradientMask("linearGradient", "m1", "Gradient 1");
  const base = mask.components[0];
  if (base.kind !== "linearGradient") throw new Error("newGradientMask lost its component kind");
  return { ...mask, components: [{ ...base, x1: 0, y1: 0.5, x2: 1, y2: 0.5 }] };
}

describe("overlay frame publishing", () => {
  it("publishes dimensions (no base) and notifies subscribers on every composite", () => {
    let notified = 0;
    const off = onOverlayFrame(() => notified++);
    compositeMasks(() => frame(200), withMask(gradientMask()), frame(100));
    expect(notified).toBe(1);
    const f = getOverlayFrame();
    expect(f).toMatchObject({ width: W, height: H });
    expect(f?.base).toBeUndefined(); // gradient masks never sample the base
    off();
    compositeMasks(() => frame(200), withMask(gradientMask()), frame(100));
    expect(notified).toBe(1); // unsubscribed
  });

  it("snapshots the base pixels when the graph has a range mask, even a neutral one", () => {
    compositeMasks(() => frame(200), withMask(newRangeMask("rangeLuminance", "m1", "Luma 1")), frame(100));
    const f = getOverlayFrame();
    expect(f?.base?.width).toBe(W);
    expect(f?.base?.height).toBe(H);
    expect(f?.base?.pixels[0]).toBe(100);
  });
});

describe("maskCoverage", () => {
  it("ramps 0 → 1 along a linear gradient's axis", () => {
    const cov = maskCoverage(gradientMask(), W, H, undefined);
    expect(cov).not.toBeNull();
    expect(cov![0]).toBe(0);
    expect(cov![W - 1]).toBe(1);
    for (let x = 1; x < W; x++) expect(cov![x]).toBeGreaterThanOrEqual(cov![x - 1]);
  });

  it("is null for an AI mask whose Select Subject never ran this session", () => {
    expect(maskCoverage(newAiSubjectMask("m1", "Subject 1", "no-such-cache"), W, H)).toBeNull();
  });
});

describe("tintCoverage", () => {
  const cov = new Float32Array([0, 0.5, 1]);

  it("color mode: tint rgb with alpha following coverage at half strength", () => {
    const px = tintCoverage(cov, "color", [255, 60, 60]);
    expect(Array.from(px.slice(0, 4))).toEqual([255, 60, 60, 0]);
    expect(px[7]).toBe(64); // 0.5 * 128
    expect(Array.from(px.slice(8, 12))).toEqual([255, 60, 60, 128]);
  });

  it("whiteOnBlack mode: opaque grayscale matte", () => {
    const px = tintCoverage(cov, "whiteOnBlack", [255, 60, 60]);
    expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(px.slice(8, 12))).toEqual([255, 255, 255, 255]);
  });
});
