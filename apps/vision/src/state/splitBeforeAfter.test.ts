// Unit tests for the Camera Raw split Before/After compositor. Engine-free
// (node); the workspace toggle + preview render are covered by the
// camera-raw-workspace e2e.
import { describe, it, expect } from "vitest";
import { splitBeforeAfter } from "./splitBeforeAfter";

/** A w×h RGBA buffer filled with a single opaque grey level. */
function solid(w: number, h: number, v: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255; }
  return px;
}

describe("splitBeforeAfter", () => {
  const w = 8, h = 6;
  const before = solid(w, h, 40);
  const after = solid(w, h, 200);
  const red = (buf: Uint8ClampedArray, x: number, y: number) => buf[(y * w + x) * 4];

  it("lr: left half is BEFORE, right half is AFTER", () => {
    const out = splitBeforeAfter(before, after, w, h, "lr");
    expect(red(out, 0, 3)).toBe(40); // far left → before
    expect(red(out, 3, 3)).toBe(40); // just left of midline (x<4)
    expect(red(out, 4, 3)).toBe(200); // at/after midline → after
    expect(red(out, 7, 3)).toBe(200); // far right → after
  });

  it("tb: top half is BEFORE, bottom half is AFTER", () => {
    const out = splitBeforeAfter(before, after, w, h, "tb");
    expect(red(out, 3, 0)).toBe(40); // top → before
    expect(red(out, 3, 2)).toBe(40); // just above midline (y<3)
    expect(red(out, 3, 3)).toBe(200); // at/below midline → after
    expect(red(out, 3, 5)).toBe(200); // bottom → after
  });

  it("preserves buffer size and opaque alpha", () => {
    const out = splitBeforeAfter(before, after, w, h, "lr");
    expect(out.length).toBe(w * h * 4);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });
});
