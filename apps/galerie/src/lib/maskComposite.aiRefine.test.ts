// GAL-MASK-05: AI (Select Subject) masks accept stacked refinement components —
// the canonical LR gesture (Subtract > Brush, Intersect > Luminance Range).
// maskCoverage folds refinements onto the cached subject coverage, and
// compositeMasks processes a refined AI mask exactly once (the AI path, not the
// parametric loop).

import { createDefaultRecipe, createMaskGraph, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { describe, expect, it, vi } from "vitest";

import { compositeMasks, getOverlayFrame, maskCoverage, type RenderedFrame } from "./maskComposite";
import { newAiSubjectMask, newComponent, renderableMasks } from "./maskEdit";
import { MasksPanel } from "../ui/MasksPanel";

// Deterministic session cache: "left" = subject covers the image's left half,
// "all" = full-frame subject. Shapes match the real 320×320 U²-Net output.
vi.mock("./subjectMask", async () => {
  const { U2NET_SIZE: N } = await import("@monet-ui/monet-scopes");
  const left = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) left[y * N + x] = 1;
  const all = new Float32Array(N * N).fill(1);
  return {
    getSubjectCoverage: (id: string) => (id === "left" ? left : id === "all" ? all : undefined),
  };
});

const W = 8;
const H = 4;

function frame(value: number): RenderedFrame {
  const rgba = new Uint8Array(W * H * 4);
  rgba.fill(value);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { rgba, width: W, height: H };
}

/** Subject-left AI mask refined with a brush dab at pixel (2,2) (of an 8×4 grid). */
function refinedAiMask(combine: "add" | "subtract") {
  const mask = newAiSubjectMask("m1", "Subject 1", "left");
  const brush = newComponent("brush", "b1", combine);
  if (brush.kind !== "brush") throw new Error("expected brush");
  // Dab centred exactly on pixel (2,2)'s normalized position; radius 0.3 of the
  // 4px short side = 1.2px, so only that pixel sees full coverage.
  brush.dabs = [{ x: 2 / (W - 1), y: 2 / (H - 1), radius: 0.3, flow: 1, density: 1, erase: false }];
  return { ...mask, components: [...mask.components, brush] };
}

const at = (cov: Float32Array, x: number, y: number) => cov[y * W + x];

describe("maskCoverage with refinement components on an AI base", () => {
  it("subtract brush carves a hole out of the subject coverage", () => {
    const cov = maskCoverage(refinedAiMask("subtract"), W, H);
    expect(cov).not.toBeNull();
    expect(at(cov!, 2, 2)).toBe(0); // carved by the brush
    expect(at(cov!, 0, 2)).toBe(1); // subject, outside the brush radius
    expect(at(cov!, 7, 2)).toBe(0); // outside the subject
  });

  it("add brush extends coverage beyond the subject", () => {
    const mask = refinedAiMask("add");
    const brush = mask.components[1];
    if (brush.kind !== "brush") throw new Error("expected brush");
    brush.dabs = [{ x: 6 / (W - 1), y: 2 / (H - 1), radius: 0.3, flow: 1, density: 1, erase: false }];
    const cov = maskCoverage(mask, W, H);
    expect(at(cov!, 6, 2)).toBe(1); // added outside the subject
    expect(at(cov!, 0, 2)).toBe(1); // subject untouched
    expect(at(cov!, 4, 2)).toBe(0); // neither subject nor brush
  });

  it("intersect luminance range keeps only the bright part of the subject", () => {
    const mask = newAiSubjectMask("m1", "Subject 1", "all");
    const luma = newComponent("rangeLuminance", "l1", "intersect");
    if (luma.kind !== "rangeLuminance") throw new Error("expected luma");
    Object.assign(luma, { min: 0.6, max: 1, smoothness: 0 });
    const refined = { ...mask, components: [...mask.components, luma] };
    const pixels = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = x < W / 2 ? 20 : 240; // left dark, right bright
        pixels.set([v, v, v, 255], (y * W + x) * 4);
      }
    const cov = maskCoverage(refined, W, H, { pixels, width: W, height: H });
    expect(at(cov!, 0, 2)).toBe(0); // subject but dark → intersect zeroes it
    expect(at(cov!, 7, 2)).toBe(1); // subject and bright → kept
  });
});

describe("compositeMasks with a refined AI mask", () => {
  function withMask(mask: DevelopRecipeV2["masks"]["masks"][number]): DevelopRecipeV2 {
    const recipe = createDefaultRecipe();
    return { ...recipe, masks: { masks: [{ ...mask, adjustments: { ...mask.adjustments, exposure: 1 } }] } };
  }

  it("renders the mask exactly once and blends through the refined coverage", () => {
    let renders = 0;
    const out = compositeMasks(
      () => {
        renders++;
        return frame(200);
      },
      withMask(refinedAiMask("subtract")),
      frame(100),
    );
    expect(renders).toBe(1); // AI path only — not double-processed by the parametric loop
    const px = (x: number, y: number) => out[(y * W + x) * 4];
    expect(px(0, 2)).toBe(200); // subject, unrefined → masked render
    expect(px(2, 2)).toBe(100); // carved by the subtract brush → base
    expect(px(7, 2)).toBe(100); // outside the subject → base
  });

  it("snapshots base pixels when the AI mask's refinement is a range component", () => {
    const mask = newAiSubjectMask("m1", "Subject 1", "all");
    const luma = newComponent("rangeLuminance", "l1", "intersect");
    compositeMasks(
      () => frame(200),
      withMask({ ...mask, components: [...mask.components, luma] }),
      frame(100),
    );
    expect(getOverlayFrame()?.base?.pixels[0]).toBe(100);
  });
});

describe("MasksPanel", () => {
  it("exports the panel (smoke: the un-gated Components UI compiles)", () => {
    expect(typeof MasksPanel).toBe("function");
  });
});

describe("renderableMasks with a refined AI mask", () => {
  it("keeps a refined AI mask out of the parametric path (base component decides)", () => {
    const graph = createMaskGraph();
    graph.masks.push(refinedAiMask("subtract"));
    expect(renderableMasks(graph)).toEqual([]);
  });
});
