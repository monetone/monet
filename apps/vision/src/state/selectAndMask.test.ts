// Unit tests for the Select and Mask workspace helpers. Engine-free (node);
// the refine math itself is pinned by the Rust tests
// (packages/engine/src/raster/mod.rs::select_and_mask_workspace). These pin the
// View-mode compositor the preview canvas renders and the Refine Edge Brush
// stamp.
import { describe, it, expect } from "vitest";
import {
  SAM_VIEW_MODES,
  SAM_OUTPUTS,
  renderSamView,
  stampSamBrush,
  type SamViewMode,
} from "./selectAndMask";

const W = 8;
const H = 4;
const N = W * H;

// Flat mid-gray composite.
function gray(): Uint8ClampedArray {
  const c = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    c[i * 4] = 100; c[i * 4 + 1] = 100; c[i * 4 + 2] = 100; c[i * 4 + 3] = 255;
  }
  return c;
}

// Left half selected (hard edge between x=3 and x=4).
function halves(): Uint8Array {
  const m = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) m[y * W + x] = 255;
  return m;
}

const px = (out: Uint8ClampedArray, x: number, y: number) => {
  const p = (y * W + x) * 4;
  return [out[p], out[p + 1], out[p + 2]];
};

describe("SAM view modes", () => {
  it("offers all seven Photoshop views and three outputs", () => {
    expect(SAM_VIEW_MODES.map((v) => v.label)).toEqual([
      "Onion Skin", "Marching Ants", "Overlay", "On Black", "On White", "Black & White", "On Layers",
    ]);
    expect(SAM_OUTPUTS).toHaveLength(3);
  });

  it("renders the plain composite when there is no selection", () => {
    const out = new Uint8ClampedArray(N * 4);
    renderSamView("onblack", 1, W, H, gray(), null, out);
    expect(px(out, 0, 0)).toEqual([100, 100, 100]);
    expect(px(out, 6, 2)).toEqual([100, 100, 100]);
  });

  it("Black & White shows the raw matte", () => {
    const out = new Uint8ClampedArray(N * 4);
    renderSamView("bw", 1, W, H, gray(), halves(), out);
    expect(px(out, 1, 1)).toEqual([255, 255, 255]);
    expect(px(out, 6, 1)).toEqual([0, 0, 0]);
  });

  it("On Black keeps the selection and sinks the rest to black at full opacity", () => {
    const out = new Uint8ClampedArray(N * 4);
    renderSamView("onblack", 1, W, H, gray(), halves(), out);
    expect(px(out, 1, 1)).toEqual([100, 100, 100]);
    expect(px(out, 6, 1)).toEqual([0, 0, 0]);
  });

  it("On White uses a white backdrop", () => {
    const out = new Uint8ClampedArray(N * 4);
    renderSamView("onwhite", 1, W, H, gray(), halves(), out);
    expect(px(out, 6, 1)).toEqual([255, 255, 255]);
  });

  it("Overlay tints only the unselected side red, scaled by opacity", () => {
    const out = new Uint8ClampedArray(N * 4);
    renderSamView("overlay", 0.5, W, H, gray(), halves(), out);
    expect(px(out, 1, 1)).toEqual([100, 100, 100]); // selected untouched
    const [r, g, b] = px(out, 6, 1); // unselected: red up, green/blue down
    expect(r).toBeGreaterThan(100);
    expect(g).toBeLessThan(100);
    expect(b).toBeLessThan(100);
  });

  it("Onion Skin at opacity 0 reveals the checkerboard on the unselected side", () => {
    const out = new Uint8ClampedArray(N * 4);
    renderSamView("onion", 0, W, H, gray(), halves(), out);
    expect(px(out, 1, 1)).toEqual([100, 100, 100]); // selected = image
    expect(px(out, 6, 1)[0]).toBeGreaterThan(200); // unselected = checker
  });

  it("Marching Ants stamps only boundary pixels", () => {
    const out = new Uint8ClampedArray(N * 4);
    renderSamView("ants", 1, W, H, gray(), halves(), out);
    expect(px(out, 1, 1)).toEqual([100, 100, 100]); // interior untouched
    expect(px(out, 6, 1)).toEqual([100, 100, 100]); // exterior untouched
    const edge = px(out, 3, 1); // selected column with unselected neighbour
    expect(edge[0] === 0 || edge[0] === 255).toBe(true);
  });

  it("every view mode fills the output alpha", () => {
    for (const { value } of SAM_VIEW_MODES) {
      const out = new Uint8ClampedArray(N * 4);
      renderSamView(value as SamViewMode, 0.5, W, H, gray(), halves(), out);
      for (let i = 0; i < N; i++) expect(out[i * 4 + 3]).toBe(255);
    }
  });
});

describe("stampSamBrush", () => {
  it("paints a clipped circle and erases it again", () => {
    const m = new Uint8Array(N);
    stampSamBrush(m, W, H, 0, 0, 2, true); // clipped at the corner — no throw
    expect(m[0]).toBe(255);
    expect(m[3 * W + 7]).toBe(0); // far corner untouched
    stampSamBrush(m, W, H, 0, 0, 2, false);
    expect(m.every((v) => v === 0)).toBe(true);
  });

  it("leaves pixels outside the radius untouched", () => {
    const m = new Uint8Array(N);
    stampSamBrush(m, W, H, 4, 2, 1.5, true);
    expect(m[2 * W + 4]).toBe(255); // centre
    expect(m[2 * W + 6]).toBe(0); // two px away
  });
});
