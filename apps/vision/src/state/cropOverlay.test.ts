// Unit tests for the crop overlay guide geometry. Engine-free (node); the preview
// rendering is covered by e2e/crop-overlay.spec.ts.
import { describe, it, expect } from "vitest";
import {
  overlayLines,
  CROP_OVERLAYS,
  nextCropOverlay,
  nextCropOverlayOrientation,
  type CropOverlay,
} from "./cropOverlay";

describe("CROP_OVERLAYS", () => {
  it("lists Photoshop's six designs in O-cycle order, then None", () => {
    expect(CROP_OVERLAYS.map((o) => o.key)).toEqual([
      "thirds", "grid", "diagonal", "triangle", "golden", "spiral", "none",
    ]);
  });

  it("cycles the six designs without cycling visibility", () => {
    const sequence: CropOverlay[] = ["thirds"];
    for (let i = 0; i < 6; i += 1) sequence.push(nextCropOverlay(sequence.at(-1)!));
    expect(sequence).toEqual(["thirds", "grid", "diagonal", "triangle", "golden", "spiral", "thirds"]);
    expect(nextCropOverlay("none")).toBe("thirds");
  });

  it("cycles only the orientations supported by the active design", () => {
    expect(nextCropOverlayOrientation("triangle", 0)).toBe(1);
    expect(nextCropOverlayOrientation("triangle", 1)).toBe(0);
    expect(nextCropOverlayOrientation("spiral", 7)).toBe(0);
    expect(nextCropOverlayOrientation("grid", 3)).toBe(3);
  });
});

describe("overlayLines", () => {
  it("returns nothing for 'none' or a non-positive rect", () => {
    expect(overlayLines("none", 0, 0, 100, 100)).toEqual([]);
    expect(overlayLines("thirds", 0, 0, 0, 100)).toEqual([]);
    expect(overlayLines("thirds", 0, 0, 100, -5)).toEqual([]);
  });

  it("thirds: 4 lines (verticals at 1/3 & 2/3 span the height, horizontals span the width)", () => {
    const ls = overlayLines("thirds", 0, 0, 300, 300);
    expect(ls).toHaveLength(4);
    // first vertical at x = 100, full height
    expect(ls[0]).toEqual({ x1: 100, y1: 0, x2: 100, y2: 300 });
    // first horizontal at y = 100, full width
    expect(ls[2]).toEqual({ x1: 0, y1: 100, x2: 300, y2: 100 });
  });

  it("grid: 6 lines at the quarter positions", () => {
    const ls = overlayLines("grid", 0, 0, 400, 400);
    expect(ls).toHaveLength(6);
    expect(ls.map((l) => l.x1)).toContain(100); // vertical at 1/4
    expect(ls.map((l) => l.x1)).toContain(300); // vertical at 3/4
  });

  it("golden: 4 lines at the φ positions (~0.382 / 0.618)", () => {
    const ls = overlayLines("golden", 0, 0, 1000, 1000);
    expect(ls).toHaveLength(4);
    expect(ls[0].x1).toBeCloseTo(381.966, 3);
    expect(ls[1].x1).toBeCloseTo(618.034, 3);
  });

  it("diagonal: draws four aspect-independent 45-degree corner rays", () => {
    const ls = overlayLines("diagonal", 10, 20, 100, 50);
    expect(ls).toEqual([
      { x1: 10, y1: 20, x2: 60, y2: 70 },
      { x1: 110, y1: 20, x2: 60, y2: 70 },
      { x1: 10, y1: 70, x2: 60, y2: 20 },
      { x1: 110, y1: 70, x2: 60, y2: 20 },
    ]);
    for (const line of ls) {
      expect(Math.abs(line.x2 - line.x1)).toBe(Math.abs(line.y2 - line.y1));
    }
    expect(overlayLines("diagonal", 0, 0, 50, 50)).toEqual([
      { x1: 0, y1: 0, x2: 50, y2: 50 },
      { x1: 50, y1: 0, x2: 0, y2: 50 },
    ]);
  });

  it("offsets all guides by the rect origin", () => {
    const ls = overlayLines("thirds", 50, 40, 300, 300);
    expect(ls[0]).toEqual({ x1: 150, y1: 40, x2: 150, y2: 340 }); // 50 + 300/3
  });

  it("triangle: uses a diagonal and two perpendicular corner branches", () => {
    const normal = overlayLines("triangle", 10, 20, 100, 50, 0);
    const flipped = overlayLines("triangle", 10, 20, 100, 50, 1);
    expect(normal).toHaveLength(3);
    expect(normal[0]).toEqual({ x1: 10, y1: 20, x2: 110, y2: 70 });
    expect(flipped[0]).toEqual({ x1: 110, y1: 20, x2: 10, y2: 70 });
    const main = { x: normal[0].x2 - normal[0].x1, y: normal[0].y2 - normal[0].y1 };
    for (const branch of normal.slice(1)) {
      const vector = { x: branch.x2 - branch.x1, y: branch.y2 - branch.y1 };
      expect(main.x * vector.x + main.y * vector.y).toBeCloseTo(0, 8);
    }
  });

  it("golden spiral: draws nested rectangles and a bounded sampled spiral in all orientations", () => {
    const normal = overlayLines("spiral", 10, 20, 200, 120, 0);
    const rotated = overlayLines("spiral", 10, 20, 200, 120, 1);
    expect(normal).toHaveLength(72);
    expect(rotated).toHaveLength(72);
    expect(rotated[0]).not.toEqual(normal[0]);
    for (const line of [...normal, ...rotated]) {
      expect(line.x1).toBeGreaterThanOrEqual(10 - 1e-8);
      expect(line.x1).toBeLessThanOrEqual(210 + 1e-8);
      expect(line.x2).toBeGreaterThanOrEqual(10 - 1e-8);
      expect(line.x2).toBeLessThanOrEqual(210 + 1e-8);
      expect(line.y1).toBeGreaterThanOrEqual(20 - 1e-8);
      expect(line.y1).toBeLessThanOrEqual(140 + 1e-8);
      expect(line.y2).toBeGreaterThanOrEqual(20 - 1e-8);
      expect(line.y2).toBeLessThanOrEqual(140 + 1e-8);
    }
  });
});
