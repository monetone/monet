import { describe, expect, it } from "vitest";

import {
  U2NET_SIZE,
  postprocessU2Net,
  preprocessU2Net,
  resampleCoverage,
  resampleRgba,
} from "./u2net";

const solid = (w: number, h: number, r: number, g: number, b: number) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = 255;
  }
  return px;
};

describe("resampleRgba", () => {
  it("upsamples a 2×2 to 4×4 preserving corner colors", () => {
    const src = new Uint8ClampedArray([
      10, 0, 0, 255, 20, 0, 0, 255,
      30, 0, 0, 255, 40, 0, 0, 255,
    ]);
    const out = resampleRgba(src, 2, 2, 4, 4);
    expect(out[0]).toBe(10); // top-left
    expect(out[(3 * 4 + 3) * 4]).toBe(40); // bottom-right
  });
});

describe("preprocessU2Net", () => {
  it("produces a full NCHW tensor with ImageNet normalization", () => {
    const chw = preprocessU2Net(solid(4, 4, 255, 0, 0), 4, 4);
    const plane = U2NET_SIZE * U2NET_SIZE;
    expect(chw).toHaveLength(3 * plane);
    // R=255 → (1-0.485)/0.229 ≈ 2.2489; G=B=0 → (0-mean)/std (negative).
    expect(chw[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(chw[plane]).toBeCloseTo((0 - 0.456) / 0.224, 4);
    expect(chw[2 * plane]).toBeCloseTo((0 - 0.406) / 0.225, 4);
  });
});

describe("postprocessU2Net", () => {
  it("min-max normalizes saliency to 0..1", () => {
    const plane = U2NET_SIZE * U2NET_SIZE;
    const out = new Float32Array(plane);
    out[0] = -2; // min
    out[1] = 6; // max
    for (let i = 2; i < plane; i++) out[i] = 2; // midpoint
    const cov = postprocessU2Net(out);
    expect(cov[0]).toBeCloseTo(0, 6);
    expect(cov[1]).toBeCloseTo(1, 6);
    expect(cov[2]).toBeCloseTo(0.5, 6); // (2 − −2)/8
  });

  it("returns all-zero coverage for a constant output (no subject)", () => {
    const plane = U2NET_SIZE * U2NET_SIZE;
    const cov = postprocessU2Net(new Float32Array(plane).fill(0.7));
    expect(cov.every((v) => v === 0)).toBe(true);
  });
});

describe("resampleCoverage", () => {
  it("scales a 320×320 field to arbitrary dims", () => {
    const plane = U2NET_SIZE * U2NET_SIZE;
    const cov = new Float32Array(plane).fill(0.42);
    const out = resampleCoverage(cov, 100, 60);
    expect(out).toHaveLength(6000);
    expect(out[0]).toBeCloseTo(0.42, 6);
    expect(out[5999]).toBeCloseTo(0.42, 6);
  });
});
