import { describe, expect, it } from "vitest";

import { applyCrop } from "./cropTransform";
import { straightenAngle } from "./straighten";

const FULL = { left: 0, top: 0, right: 1, bottom: 1 };

describe("straightenAngle", () => {
  it("is zero for a level line and a too-short one", () => {
    expect(straightenAngle(0.2, 0.5, 0.8, 0.5, 1)).toBe(0);
    expect(straightenAngle(0.5, 0.5, 0.5, 0.5, 1)).toBe(0); // no length
  });

  it("corrects a horizon tilted down-to-the-right with an equal opposite angle", () => {
    // Line drops 0.1 over 1.0 width on a square image → ~5.7° → correction ~-5.7°.
    const a = straightenAngle(0, 0.45, 1, 0.55, 1);
    expect(a).toBeLessThan(0);
    expect(a).toBeCloseTo(-Math.atan2(0.1, 1) * (180 / Math.PI), 4);
  });

  it("snaps a near-vertical wall to vertical, not to level", () => {
    // Almost straight down, leaning slightly right at the bottom.
    const a = straightenAngle(0.5, 0.1, 0.55, 0.9, 1);
    // Small correction toward vertical (|a| well under 45), not a ~85° flip.
    expect(Math.abs(a)).toBeLessThan(10);
    expect(a).not.toBe(0);
  });

  it("measures the tilt in true pixels — image aspect changes the angle", () => {
    // The same normalized line reads as less tilted on a wider image.
    const square = Math.abs(straightenAngle(0, 0.4, 1, 0.6, 1));
    const wide = Math.abs(straightenAngle(0, 0.4, 1, 0.6, 3));
    expect(wide).toBeLessThan(square);
  });

  it("clamps to ±45°", () => {
    expect(straightenAngle(0, 0, 0.2, 1, 1)).toBeLessThanOrEqual(45);
    expect(straightenAngle(0, 0, 0.2, 1, 1)).toBeGreaterThanOrEqual(-45);
  });

  it("undoes an applyCrop tilt end-to-end (sign matches the render pipeline)", () => {
    // A horizontal edge at the image's mid-row.
    const W = 60;
    const H = 60;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = y >= 30 ? 255 : 0;
        const o = (y * W + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
        rgba[o + 3] = 255;
      }
    }
    const img = { rgba, width: W, height: H };
    // First row (top→down) whose luma crosses to white in a column.
    const edgeRow = (im: { rgba: Uint8ClampedArray; width: number; height: number }, col: number): number => {
      for (let y = 0; y < im.height; y++) if (im.rgba[(y * im.width + col) * 4] >= 128) return y;
      return -1;
    };

    // Tilt the image, then trace the now-slanted edge and straighten from it.
    const tilted = applyCrop(img, { rect: FULL, angle: 8 });
    const r1 = edgeRow(tilted, 15);
    const r2 = edgeRow(tilted, 45);
    expect(r1).toBeGreaterThan(0);
    expect(r2).toBeGreaterThan(0);
    expect(Math.abs(r1 - r2)).toBeGreaterThan(2); // the edge is visibly slanted

    const angle = straightenAngle(15 / W, r1 / H, 45 / W, r2 / H, 1);
    const releveled = applyCrop(tilted, { rect: FULL, angle });
    const s1 = edgeRow(releveled, 15);
    const s2 = edgeRow(releveled, 45);
    // A wrong sign would double the tilt; the correct one flattens it.
    expect(Math.abs(s1 - s2)).toBeLessThanOrEqual(2);
  });
});
