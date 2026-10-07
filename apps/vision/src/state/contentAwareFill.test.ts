// #430: the Content-Aware Fill workspace's Sampling Area presets and overlay.
// What the engine does with the mask is covered in packages/engine.
import { describe, expect, it } from "vitest";
import { samplingPreset, tintSamplingOverlay } from "./contentAwareFill";

const W = 20;
const H = 10;
/** A 4×2 selection at (8,4); the corner pixel is only half selected. */
function selection() {
  const sel = new Uint8Array(W * H);
  for (let y = 4; y < 6; y++) for (let x = 8; x < 12; x++) sel[y * W + x] = 255;
  sel[4 * W + 8] = 128;
  return sel;
}

describe("samplingPreset", () => {
  it("Auto samples exactly the complement of the selection", () => {
    const sel = selection();
    const auto = samplingPreset("auto", sel, W, H);
    for (let i = 0; i < W * H; i++) expect(auto[i], `pixel ${i}`).toBe(sel[i] > 127 ? 0 : 255);
  });

  it("Rectangular grows the selection's box by half its longer side, clamped, minus the hole", () => {
    const sel = selection();
    const rect = samplingPreset("rectangular", sel, W, H);
    // Box x 8..11, y 4..5 (4×2) grows by 2: x 6..13, y 2..7.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inBox = x >= 6 && x <= 13 && y >= 2 && y <= 7;
        const want = inBox && sel[y * W + x] <= 127 ? 255 : 0;
        expect(rect[y * W + x], `(${x},${y})`).toBe(want);
      }
    }
    // A selection on the edge clamps to the document.
    const edge = new Uint8Array(W * H);
    edge[0] = 255;
    const clamped = samplingPreset("rectangular", edge, W, H);
    expect(Array.from(clamped.slice(0, 3))).toEqual([0, 255, 0]);
    expect(clamped[W + 1]).toBe(255);
  });

  it("Custom starts empty, and a preset over no selection samples nothing", () => {
    expect(samplingPreset("custom", selection(), W, H).some((v) => v)).toBe(false);
    expect(samplingPreset("rectangular", new Uint8Array(W * H), W, H).some((v) => v)).toBe(false);
  });
});

describe("tintSamplingOverlay", () => {
  it("tints only the sampled pixels", () => {
    const src = new Uint8ClampedArray(4 * 4).fill(100);
    const sample = Uint8Array.from([0, 255, 127, 128]);
    const out = new Uint8ClampedArray(src.length);
    tintSamplingOverlay(src, sample, out);
    expect(Array.from(out.slice(0, 4))).toEqual([100, 100, 100, 100]);
    expect(Array.from(out.slice(8, 12))).toEqual([100, 100, 100, 100]);
    for (const p of [4, 12]) {
      expect(out[p + 1], "sampled pixels lean green").toBeGreaterThan(out[p]);
      expect(out[p + 3]).toBe(100);
    }
  });
});
