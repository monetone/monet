// Unit tests for the Camera Raw "Visualize Spots" preview transform. Engine-free
// (node); the workspace toggle + preview render are covered by the
// camera-raw-workspace e2e.
import { describe, it, expect } from "vitest";
import { visualizeSpots } from "./visualizeSpots";

/** Build a w×h RGBA buffer whose left half is black and right half white. */
function splitImage(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x >= w / 2 ? 255 : 0;
      const i = (y * w + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

describe("visualizeSpots", () => {
  it("renders a flat field as pure black (no edges) with opaque alpha", () => {
    const flat = new Uint8ClampedArray(8 * 6 * 4).fill(0);
    for (let i = 0; i < flat.length; i += 4) { flat[i] = 130; flat[i + 1] = 130; flat[i + 2] = 130; flat[i + 3] = 255; }
    const out = visualizeSpots(flat, 8, 6, 0.5);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(0); // no gradient → black
      expect(out[i + 3]).toBe(255); // opaque
    }
  });

  it("lights up a sharp edge (bright at the boundary, black in flat regions)", () => {
    const w = 8, h = 4;
    const out = visualizeSpots(splitImage(w, h), w, h, 0.5);
    const at = (x: number, y: number) => out[(y * w + x) * 4];
    expect(at(3, 1)).toBeGreaterThan(150); // straddles the black|white boundary
    expect(at(0, 1)).toBe(0); // far-left flat region
    expect(at(7, 1)).toBe(0); // far-right flat region
  });

  it("a higher threshold brightens the same edge (more sensitive)", () => {
    const w = 8, h = 4;
    const img = splitImage(w, h);
    const low = visualizeSpots(img, w, h, 0.05)[(1 * w + 3) * 4];
    const high = visualizeSpots(img, w, h, 0.95)[(1 * w + 3) * 4];
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("preserves the buffer size", () => {
    expect(visualizeSpots(new Uint8ClampedArray(5 * 5 * 4), 5, 5, 0.5).length).toBe(5 * 5 * 4);
  });
});
