import { describe, expect, it } from "vitest";

import { channelPath, computeHistogram } from "./histogram";

// Build an RGBA buffer from [r,g,b,a] tuples.
function rgba(...px: [number, number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length * 4);
  px.forEach((p, i) => out.set(p, i * 4));
  return out;
}

describe("computeHistogram", () => {
  it("bins each channel and computes Rec.601 luma", () => {
    // One pure-white + one pure-red pixel.
    const h = computeHistogram(rgba([255, 255, 255, 255], [255, 0, 0, 255]));
    expect(h.r[255]).toBe(2);
    expect(h.g[255]).toBe(1);
    expect(h.b[255]).toBe(1);
    expect(h.g[0]).toBe(1); // red pixel's green channel
    // Red luma = 255*0.299 = 76.2 → bucket 76; white → bucket 255.
    expect(h.lum[76]).toBe(1);
    expect(h.lum[255]).toBe(1);
  });

  it("ignores fully-transparent pixels (letterbox padding)", () => {
    const h = computeHistogram(rgba([0, 0, 0, 0], [128, 128, 128, 255]));
    expect(h.r[0]).toBe(0); // the transparent black must not count
    expect(h.r[128]).toBe(1);
  });

  it("max excludes the clipping endpoints 0 and 255", () => {
    // 10 mid-gray + 100 clipped-white pixels: max reflects the mid, not the spike.
    const px: [number, number, number, number][] = [];
    for (let i = 0; i < 10; i++) px.push([128, 128, 128, 255]);
    for (let i = 0; i < 100; i++) px.push([255, 255, 255, 255]);
    const h = computeHistogram(rgba(...px));
    expect(h.r[255]).toBe(100);
    expect(h.max).toBe(10); // endpoint spike at 255 ignored
  });
});

describe("channelPath", () => {
  it("spans the box and closes along the baseline", () => {
    const ch = new Uint32Array(256);
    ch[128] = 5;
    const d = channelPath(ch, 5, 255, 100);
    expect(d.startsWith("M0,100")).toBe(true);
    expect(d.endsWith("L255,100 Z")).toBe(true);
    // The full-height bucket reaches y=0 at its x (128/255*255 = 128).
    expect(d).toContain("L128.00,0.00");
  });
});
