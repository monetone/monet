// GAL-MASK-04: Select Background — the complement of Select Subject, sharing
// the same cached U²-Net coverage. newAiBackgroundMask constructs the
// `aiBackground` component the schema/Rust already accept, and maskCoverage /
// compositeMasks render it as the inverted subject coverage.

import { createDefaultRecipe, createMaskGraph, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { describe, expect, it, vi } from "vitest";

import { compositeMasks, maskCoverage, type RenderedFrame } from "./maskComposite";
import { newAiBackgroundMask, newComponent, renderableMasks } from "./maskEdit";

// Deterministic session cache: "left" = subject covers the image's left half.
// Shape matches the real 320×320 U²-Net output.
vi.mock("./subjectMask", async () => {
  const { U2NET_SIZE: N } = await import("@monet-ui/monet-scopes");
  const left = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) left[y * N + x] = 1;
  return { getSubjectCoverage: (id: string) => (id === "left" ? left : undefined) };
});

const W = 8;
const H = 4;

function frame(value: number): RenderedFrame {
  const rgba = new Uint8Array(W * H * 4);
  rgba.fill(value);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { rgba, width: W, height: H };
}

const at = (cov: Float32Array, x: number, y: number) => cov[y * W + x];

describe("maskCoverage for an aiBackground mask", () => {
  it("is the complement of the cached subject coverage", () => {
    const cov = maskCoverage(newAiBackgroundMask("m1", "Background 1", "left"), W, H);
    expect(cov).not.toBeNull();
    expect(at(cov!, 0, 2)).toBe(0); // subject (left) → excluded
    expect(at(cov!, 7, 2)).toBe(1); // background (right) → selected
  });

  it("component invert folds on top (background inverted = subject)", () => {
    const mask = newAiBackgroundMask("m1", "Background 1", "left");
    mask.components[0].invert = true;
    const cov = maskCoverage(mask, W, H);
    expect(at(cov!, 0, 2)).toBe(1);
    expect(at(cov!, 7, 2)).toBe(0);
  });

  it("accepts stacked refinements (subtract brush carves out of the background)", () => {
    const mask = newAiBackgroundMask("m1", "Background 1", "left");
    const brush = newComponent("brush", "b1", "subtract");
    if (brush.kind !== "brush") throw new Error("expected brush");
    // Dab centred on pixel (6,2); radius 0.3 of the 4px short side = 1.2px.
    brush.dabs = [{ x: 6 / (W - 1), y: 2 / (H - 1), radius: 0.3, flow: 1, density: 1, erase: false }];
    const cov = maskCoverage({ ...mask, components: [...mask.components, brush] }, W, H);
    expect(at(cov!, 6, 2)).toBe(0); // carved by the brush
    expect(at(cov!, 4, 2)).toBe(1); // background, outside the brush falloff
    expect(at(cov!, 0, 2)).toBe(0); // subject → never background
  });

  it("returns null when the coverage was never computed this session", () => {
    expect(maskCoverage(newAiBackgroundMask("m1", "Background 1", "stale"), W, H)).toBeNull();
  });
});

describe("compositeMasks with an aiBackground mask", () => {
  it("blends the masked render through the inverted subject coverage", () => {
    const mask = newAiBackgroundMask("m1", "Background 1", "left");
    const recipe = createDefaultRecipe();
    const withMask: DevelopRecipeV2 = {
      ...recipe,
      masks: { masks: [{ ...mask, adjustments: { ...mask.adjustments, exposure: 1 } }] },
    };
    let renders = 0;
    const out = compositeMasks(
      () => {
        renders++;
        return frame(200);
      },
      withMask,
      frame(100),
    );
    expect(renders).toBe(1); // AI path only — not double-processed by the parametric loop
    const px = (x: number, y: number) => out[(y * W + x) * 4];
    expect(px(7, 2)).toBe(200); // background → masked render
    expect(px(0, 2)).toBe(100); // subject → base untouched
  });
});

describe("renderableMasks with an aiBackground mask", () => {
  it("keeps it out of the parametric path", () => {
    const graph = createMaskGraph();
    graph.masks.push(newAiBackgroundMask("m1", "Background 1", "left"));
    expect(renderableMasks(graph)).toEqual([]);
  });
});
