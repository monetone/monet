// Red Eye / Pet Eye Correction (GAL-DEV-26): the tool turns one click into a
// radial mask over the pupil, so the detection has to find the pupil from a
// sloppy click, size it to the actual red disc, and refuse skin/lips — a wrong
// radius here is a grey smear on a face.

import { describe, expect, it } from "vitest";

import { findRedEyePupil } from "./DevelopView";

const W = 40;
const H = 30;

/** A skin-toned frame with one filled disc of `color` at (cx, cy). */
function frame(cx: number, cy: number, r: number, color: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const [cr, cg, cb] = inside ? color : [200, 150, 140]; // skin: red-ish but not red-eye
      d[i] = cr;
      d[i + 1] = cg;
      d[i + 2] = cb;
      d[i + 3] = 255;
    }
  }
  return d;
}

const RED: [number, number, number] = [220, 30, 30];
const GLOW: [number, number, number] = [210, 235, 190]; // tapetum green-white

describe("findRedEyePupil", () => {
  it("centres on the red pupil and sizes it to the disc", () => {
    const d = frame(12, 10, 4, RED);
    const found = findRedEyePupil(d, W, H, 12, 10, 8);
    expect(found).not.toBeNull();
    expect(found!.x).toBe(12);
    expect(found!.y).toBe(10);
    // Grown to the disc edge, never past it.
    expect(found!.radius).toBeGreaterThanOrEqual(3);
    expect(found!.radius).toBeLessThanOrEqual(4);
  });

  it("re-centres a click that missed the pupil", () => {
    const d = frame(12, 10, 4, RED);
    const found = findRedEyePupil(d, W, H, 16, 13, 8); // off the disc, inside the search box
    expect(found).not.toBeNull();
    expect(Math.abs(found!.x - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(found!.y - 10)).toBeLessThanOrEqual(1);
  });

  it("returns null on skin — a warm face is not a flash pupil", () => {
    const d = frame(12, 10, 4, [205, 155, 145]); // disc barely differs from the skin
    expect(findRedEyePupil(d, W, H, 12, 10, 8)).toBeNull();
  });

  it("ignores a red pupil outside the click's search radius", () => {
    const d = frame(4, 4, 3, RED);
    expect(findRedEyePupil(d, W, H, 30, 24, 6)).toBeNull();
  });

  it("finds a pet's bright glow only in pet mode", () => {
    const d = frame(20, 15, 3, GLOW);
    expect(findRedEyePupil(d, W, H, 20, 15, 8)).toBeNull(); // not red → no red-eye
    const pet = findRedEyePupil(d, W, H, 20, 15, 8, true);
    expect(pet).not.toBeNull();
    expect(pet!.x).toBe(20);
    expect(pet!.y).toBe(15);
    expect(pet!.radius).toBeGreaterThanOrEqual(2);
    expect(pet!.radius).toBeLessThanOrEqual(3);
  });

  it("does not grow the radius across a gap to a second red blob", () => {
    const d = frame(12, 10, 3, RED);
    // A red lip patch 10px away, inside the same search box.
    for (let y = 18; y < 22; y++) {
      for (let x = 10; x < 16; x++) {
        const i = (y * W + x) * 4;
        d[i] = RED[0];
        d[i + 1] = RED[1];
        d[i + 2] = RED[2];
      }
    }
    const found = findRedEyePupil(d, W, H, 12, 10, 12);
    expect(found).not.toBeNull();
    expect(found!.radius).toBeLessThanOrEqual(3);
  });
});
