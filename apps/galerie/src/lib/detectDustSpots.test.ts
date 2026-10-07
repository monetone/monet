// Unit tests for the dust-spot detector (mirrors the Vision original's cases).
import { describe, expect, it } from "vitest";

import { detectDustSpots, healSourceFor } from "@monet-ui/monet-photo";

/** A w×h opaque grey field. */
function field(w: number, h: number, base: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = base;
    px[i + 1] = base;
    px[i + 2] = base;
    px[i + 3] = 255;
  }
  return px;
}

/** Stamp a (2r+1)² blob of `val` centred at (cx,cy). */
function blob(px: Uint8ClampedArray, w: number, cx: number, cy: number, r: number, val: number): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const i = ((cy + dy) * w + (cx + dx)) * 4;
      px[i] = val;
      px[i + 1] = val;
      px[i + 2] = val;
      px[i + 3] = 255;
    }
}

describe("detectDustSpots", () => {
  it("finds nothing on a smooth field", () => {
    expect(detectDustSpots(field(40, 40, 150), 40, 40)).toEqual([]);
  });

  it("finds planted spots near their locations", () => {
    const w = 48;
    const h = 48;
    const px = field(w, h, 160);
    blob(px, w, 12, 12, 1, 20); // a small dark speck
    blob(px, w, 34, 30, 1, 20);
    const spots = detectDustSpots(px, w, h, { sensitivity: 0.7 });
    expect(spots.length).toBeGreaterThanOrEqual(2);
    const near = (nx: number, ny: number) =>
      spots.some((s) => Math.abs(s.x * w - nx) < 4 && Math.abs(s.y * h - ny) < 4);
    expect(near(12, 12)).toBe(true);
    expect(near(34, 30)).toBe(true);
  });

  it("higher sensitivity finds at least as many spots", () => {
    const w = 48;
    const h = 48;
    const px = field(w, h, 160);
    blob(px, w, 12, 12, 1, 110); // faint
    blob(px, w, 34, 30, 1, 20); // strong
    const low = detectDustSpots(px, w, h, { sensitivity: 0.1 }).length;
    const high = detectDustSpots(px, w, h, { sensitivity: 0.95 }).length;
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("respects maxSpots", () => {
    const w = 60;
    const h = 60;
    const px = field(w, h, 160);
    for (let i = 0; i < 20; i++) blob(px, w, 5 + (i % 5) * 11, 5 + Math.floor(i / 5) * 13, 1, 20);
    expect(detectDustSpots(px, w, h, { sensitivity: 0.9, maxSpots: 4 }).length).toBeLessThanOrEqual(4);
  });

  it("healSourceFor offsets toward the centre and stays in bounds", () => {
    const s = healSourceFor({ x: 0.2, y: 0.8, radius: 0.02 });
    expect(s.sourceX).toBeGreaterThan(0.2); // pulled right (toward centre)
    expect(s.sourceY).toBeLessThan(0.8); // pulled up (toward centre)
    expect(s.sourceX).toBeLessThanOrEqual(1);
    expect(s.sourceY).toBeGreaterThanOrEqual(0);
  });
});
