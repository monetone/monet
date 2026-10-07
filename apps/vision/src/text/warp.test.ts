// ─────────────────────────────────────────────────────────────
// warp.test — Text envelope warp (Photoshop's 15 warp styles)
// ─────────────────────────────────────────────────────────────
// warp.ts is pure typed-array work (no DOM/canvas), but had no coverage. It
// only exports warpBitmap, so we test it behaviorally: the identity fast-path,
// fresh-buffer semantics, keystone-only distortion, that a style actually grows
// and fills the deformed bounding box, ±bend symmetry, and that vertical
// orientation is the transpose of horizontal.

import { describe, it, expect } from "vitest";
import { warpBitmap, type Bitmap } from "./warp";
import type { TextWarp } from "./spec";

const warp = (over: Partial<TextWarp> = {}): TextWarp => ({ style: "none", bend: 0, h: 0, v: 0, orient: "h", ...over });

/** A solid w×h bitmap filled with one RGBA color (default opaque white). */
function solid(w: number, h: number, rgba: [number, number, number, number] = [255, 255, 255, 255]): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { w, h, data };
}

function countOpaque(b: Bitmap): number {
  let n = 0;
  for (let i = 3; i < b.data.length; i += 4) if (b.data[i] > 0) n++;
  return n;
}

describe("identity fast-path", () => {
  it("style 'none' returns a fresh, unchanged copy centred on the source", () => {
    const src = solid(20, 10);
    const out = warpBitmap(src, warp());
    expect(out.w).toBe(20);
    expect(out.h).toBe(10);
    expect(out.data).toEqual(src.data); // same pixels
    expect(out.data).not.toBe(src.data); // but a new buffer (no aliasing into the source)
    expect(out.cx).toBe(10);
    expect(out.cy).toBe(5);
  });

  it("any style with bend 0 and no keystone is still identity", () => {
    const src = solid(16, 16, [10, 20, 30, 255]);
    const out = warpBitmap(src, warp({ style: "arc", bend: 0 }));
    expect(out.w).toBe(16);
    expect(out.h).toBe(16);
    expect(out.data).toEqual(src.data);
  });
});

describe("keystone distortion (no style)", () => {
  it("horizontal distortion alone widens the box beyond the source", () => {
    const src = solid(24, 24);
    const out = warpBitmap(src, warp({ h: 0.6 })); // style 'none' but h≠0 → not identity
    expect(out.w).toBeGreaterThan(src.w);
    expect(countOpaque(out)).toBeGreaterThan(0);
  });
});

describe("style warps", () => {
  it("arc bows the vertical extent and preserves most of the opaque mass", () => {
    const src = solid(24, 24);
    const out = warpBitmap(src, warp({ style: "arc", bend: 0.6 }));
    expect(out.h).toBeGreaterThan(src.h); // the bow pushes pixels above the original box
    // a bow is near-isometric, so the warped block keeps most of its coverage
    expect(countOpaque(out)).toBeGreaterThan(0.5 * src.w * src.h);
    // the reported centre lands inside the produced bitmap
    expect(out.cx).toBeGreaterThanOrEqual(0);
    expect(out.cx).toBeLessThanOrEqual(out.w);
    expect(out.cy).toBeGreaterThanOrEqual(0);
    expect(out.cy).toBeLessThanOrEqual(out.h);
  });

  it("+bend and −bend are vertical mirrors → identical output dimensions", () => {
    const src = solid(24, 24);
    const up = warpBitmap(src, warp({ style: "arc", bend: 0.5 }));
    const down = warpBitmap(src, warp({ style: "arc", bend: -0.5 }));
    expect(up.w).toBe(down.w);
    expect(up.h).toBe(down.h);
  });
});

describe("orientation", () => {
  it("vertical orientation is the transpose of horizontal (axes swapped)", () => {
    const src = solid(20, 20); // uniform square ⇒ transpose-invariant source
    const h = warpBitmap(src, warp({ style: "arc", bend: 0.5, orient: "h" }));
    const v = warpBitmap(src, warp({ style: "arc", bend: 0.5, orient: "v" }));
    expect(v.w).toBe(h.h);
    expect(v.h).toBe(h.w);
  });
});

describe("robustness", () => {
  it("a 1×1 source warps without throwing and yields a valid bitmap", () => {
    const out = warpBitmap(solid(1, 1), warp({ style: "twist", bend: 0.8 }));
    expect(out.w).toBeGreaterThanOrEqual(1);
    expect(out.h).toBeGreaterThanOrEqual(1);
    expect(out.data.length).toBe(out.w * out.h * 4);
  });
});
