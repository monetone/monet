// Before/After (GAL-DEV-11): pins the Y-family layout cycle (Y / ⇧Y / ⌥Y over
// LR's four views) and the split compositor — the Before half must land
// exactly left of / above the seam, and a size drift (photo switch mid-flight)
// must skip the composite instead of tearing the frame.

import { describe, expect, it } from "vitest";

import { compositeSplit, cycleBALayout, isSplitLayout, type BALayout } from "./DevelopView";

describe("cycleBALayout", () => {
  it("⇧Y toggles the split variant within the current orientation", () => {
    expect(cycleBALayout("leftRight", "split")).toBe("splitLR");
    expect(cycleBALayout("splitLR", "split")).toBe("leftRight");
    expect(cycleBALayout("topBottom", "split")).toBe("splitTB");
    expect(cycleBALayout("splitTB", "split")).toBe("topBottom");
  });

  it("⌥Y flips the orientation keeping the split variant", () => {
    expect(cycleBALayout("leftRight", "orient")).toBe("topBottom");
    expect(cycleBALayout("topBottom", "orient")).toBe("leftRight");
    expect(cycleBALayout("splitLR", "orient")).toBe("splitTB");
    expect(cycleBALayout("splitTB", "orient")).toBe("splitLR");
  });

  it("reaches all four LR layouts from the default", () => {
    const seen = new Set<BALayout>();
    let l: BALayout = "leftRight";
    for (const key of ["split", "orient", "split", "orient"] as const) {
      seen.add(l);
      l = cycleBALayout(l, key);
    }
    expect(seen.size).toBe(4);
  });
});

describe("isSplitLayout", () => {
  it("marks exactly the two split variants", () => {
    expect(isSplitLayout("splitLR")).toBe(true);
    expect(isSplitLayout("splitTB")).toBe(true);
    expect(isSplitLayout("leftRight")).toBe(false);
    expect(isSplitLayout("topBottom")).toBe(false);
  });
});

describe("compositeSplit", () => {
  // 4×2 frames: After all 9s, Before all 1s. px(x, y) reads the red channel.
  const w = 4;
  const h = 2;
  const frame = (v: number) => new Uint8ClampedArray(w * h * 4).fill(v);
  const px = (buf: Uint8ClampedArray, x: number, y: number) => buf[(y * w + x) * 4];

  it("left/right split puts Before pixels strictly left of the seam", () => {
    const after = frame(9);
    expect(compositeSplit(after, frame(1), w, h, false)).toBe(true);
    for (let y = 0; y < h; y++) {
      expect(px(after, 0, y)).toBe(1);
      expect(px(after, 1, y)).toBe(1);
      expect(px(after, 2, y)).toBe(9);
      expect(px(after, 3, y)).toBe(9);
    }
  });

  it("top/bottom split puts Before pixels strictly above the seam", () => {
    const after = frame(9);
    expect(compositeSplit(after, frame(1), w, h, true)).toBe(true);
    for (let x = 0; x < w; x++) {
      expect(px(after, x, 0)).toBe(1);
      expect(px(after, x, 1)).toBe(9);
    }
  });

  it("skips (and reports) a size drift without touching the After frame", () => {
    const after = frame(9);
    expect(compositeSplit(after, new Uint8ClampedArray(8).fill(1), w, h, false)).toBe(false);
    expect(compositeSplit(after, frame(1), w + 1, h, false)).toBe(false);
    expect(after.every((v) => v === 9)).toBe(true);
  });
});
