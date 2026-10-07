// The regression this file exists for: Export / Web / Print used to drop every
// local mask because compositing lived only in the Develop preview loop.

import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { describe, expect, it } from "vitest";

import { compositeMasks, hasActiveMasks, type RenderedFrame } from "./maskComposite";
import { newGradientMask, newRangeMask } from "./maskEdit";

const W = 8;
const H = 4;

function frame(value: number): RenderedFrame {
  const rgba = new Uint8Array(W * H * 4);
  rgba.fill(value);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { rgba, width: W, height: H };
}

/** A depth-range mask (default near/far/smoothness = 0/0.5/0.5) with a
 *  non-neutral local exposure, so compositeMasks actually renders it. */
function withDepthMask(): DevelopRecipeV2 {
  const recipe = createDefaultRecipe();
  const mask = newRangeMask("rangeDepth", "m1", "Depth 1");
  return {
    ...recipe,
    masks: { masks: [{ ...mask, adjustments: { ...mask.adjustments, exposure: 1 } }] },
  };
}

/** A left→right linear gradient mask with a non-neutral local exposure. */
function withGradientMask(): DevelopRecipeV2 {
  const recipe = createDefaultRecipe();
  const mask = newGradientMask("linearGradient", "m1", "Gradient 1");
  const base = mask.components[0];
  if (base.kind !== "linearGradient") throw new Error("newGradientMask lost its component kind");
  return {
    ...recipe,
    masks: {
      masks: [
        {
          ...mask,
          components: [{ ...base, x1: 0, y1: 0.5, x2: 1, y2: 0.5 }],
          adjustments: { ...mask.adjustments, exposure: 1 },
        },
      ],
    },
  };
}

describe("compositeMasks", () => {
  it("leaves a maskless frame untouched and never re-renders", () => {
    let renders = 0;
    const out = compositeMasks(() => { renders++; return frame(255); }, createDefaultRecipe(), frame(100));
    expect(renders).toBe(0);
    expect(Array.from(out.slice(0, 4))).toEqual([100, 100, 100, 255]);
  });

  it("blends the masked render through the mask's coverage", () => {
    const out = compositeMasks(() => frame(200), withGradientMask(), frame(100));
    // Coverage ramps 0 → 1 along the gradient axis (left → right here), so the
    // blend walks from the base render to the masked one, monotonically.
    const px = (x: number) => out[x * 4];
    expect(px(0)).toBe(100);
    expect(px(W - 1)).toBe(200);
    for (let x = 1; x < W; x++) expect(px(x)).toBeGreaterThanOrEqual(px(x - 1));
  });

  it("skips a mask whose local adjustments are all neutral", () => {
    const recipe = withGradientMask();
    const neutral: DevelopRecipeV2 = {
      ...recipe,
      masks: { masks: [{ ...recipe.masks.masks[0], adjustments: createDefaultRecipe().masks.masks[0]?.adjustments ?? newGradientMask("linearGradient", "m1", "n").adjustments }] },
    };
    let renders = 0;
    compositeMasks(() => { renders++; return frame(200); }, neutral, frame(100));
    expect(renders).toBe(0);
  });

  it("skips a disabled mask", () => {
    const recipe = withGradientMask();
    const disabled: DevelopRecipeV2 = {
      ...recipe,
      masks: { masks: [{ ...recipe.masks.masks[0], enabled: false }] },
    };
    let renders = 0;
    compositeMasks(() => { renders++; return frame(200); }, disabled, frame(100));
    expect(renders).toBe(0);
  });

  // GAL-MASK-07: a depth-range mask's coverage came out zero everywhere
  // because compositeMasks never attached the rendered frame's depth channel
  // to the base it passes to computeMaskCoverage — regardless of whether a
  // depth map existed. This proves coverage is non-zero once one is present.
  it("attaches the frame's depth map so a depth-range mask actually covers pixels", () => {
    // Depth ramps 0 → 1 left→right (constant per column); the default band
    // [0, 0.5] with 0.5 smoothness covers x=0 fully and x=W-1 not at all.
    const depth = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) depth[y * W + x] = x / (W - 1);
    const src: RenderedFrame = { ...frame(100), depth };
    const out = compositeMasks(() => frame(200), withDepthMask(), src);
    const px = (x: number) => out[x * 4];
    expect(px(0)).toBe(200); // inside the depth band → fully masked render
    expect(px(W - 1)).toBe(100); // outside the band → base only
  });
});

describe("hasActiveMasks", () => {
  it("is false for a default recipe and true once a mask carries an adjustment", () => {
    expect(hasActiveMasks(createDefaultRecipe())).toBe(false);
    expect(hasActiveMasks(withGradientMask())).toBe(true);
  });
});
