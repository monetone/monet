// Guards #419: Layer Style contours were six fixed presets with no way to
// author a curve. A slot now holds either a built-in index (0-5) or a custom
// curve (100 + library position); the engine reads the same encoding, so the
// two halves must agree about it.
import { describe, expect, it } from "vitest";

import {
  BUILTIN_CONTOURS,
  CONTOUR_SAMPLES,
  CUSTOM_CONTOUR_BASE,
  contourLabel,
  contourOptions,
  customContourIndex,
  customContourSlot,
  evalContour,
  flattenContours,
  newContour,
  normalizeContours,
} from "./contours";

const lib = [
  { name: "S-Curve", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }] },
  { name: "Steep", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
];

describe("contour slot encoding (#419)", () => {
  it("keeps built-ins as plain indices and customs above the base", () => {
    expect(customContourIndex(0)).toBeNull();
    expect(customContourIndex(5)).toBeNull();
    expect(customContourSlot(0)).toBe(CUSTOM_CONTOUR_BASE);
    expect(customContourIndex(customContourSlot(3))).toBe(3);
  });

  it("offers the built-ins then the library, in that order", () => {
    expect(contourOptions(lib)).toEqual([...BUILTIN_CONTOURS, "S-Curve", "Steep"]);
  });

  it("falls back to Linear for a curve a style outlived", () => {
    // Deleting a contour must not leave styles referencing a blank name.
    expect(contourLabel(customContourSlot(9), lib)).toBe("Linear");
    expect(contourLabel(customContourSlot(0), lib)).toBe("S-Curve");
    expect(contourLabel(2, lib)).toBe("Cone - Inverted");
  });
});

describe("contour evaluation (#419)", () => {
  it("interpolates between points and clamps outside them", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(evalContour(pts, 0.25)).toBeCloseTo(0.25);
    expect(evalContour(pts, -1)).toBe(0);
    expect(evalContour(pts, 2)).toBe(1);
  });

  it("is order-independent, so a dragged point past its neighbour still works", () => {
    const jumbled = [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0.5, y: 0.9 }];
    expect(evalContour(jumbled, 0.5)).toBeCloseTo(0.9);
  });

  it("passes a degenerate curve straight through rather than flattening output", () => {
    expect(evalContour([{ x: 0, y: 0 }], 0.7)).toBeCloseTo(0.7);
  });

  it("starts a new contour linear, like Photoshop", () => {
    const c = newContour("Fresh");
    expect(evalContour(c.points, 0.3)).toBeCloseTo(0.3);
  });
});

describe("flattening for the engine (#419)", () => {
  it("emits one fixed-length LUT per curve, in library order", () => {
    const { flat, lengths } = flattenContours(lib);
    expect(Array.from(lengths)).toEqual([CONTOUR_SAMPLES, CONTOUR_SAMPLES]);
    expect(flat.length).toBe(2 * CONTOUR_SAMPLES);
    expect(flat[0]).toBeCloseTo(0);
    expect(flat[CONTOUR_SAMPLES - 1]).toBeCloseTo(1);
    // The S-curve bulges above linear at its midpoint; the straight one does not.
    expect(flat[Math.floor(CONTOUR_SAMPLES / 2)]).toBeGreaterThan(0.5);
    expect(flat[CONTOUR_SAMPLES + Math.floor(CONTOUR_SAMPLES / 2)]).toBeCloseTo(0.5, 1);
  });

  it("emits nothing for an empty library", () => {
    const { flat, lengths } = flattenContours([]);
    expect(flat.length).toBe(0);
    expect(lengths.length).toBe(0);
  });
});

describe("stored library normalization (#419)", () => {
  it("drops entries that cannot make a curve", () => {
    expect(normalizeContours([
      { name: "ok", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { name: "too few", points: [{ x: 0, y: 0 }] },
      { name: "no points" },
      { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, // unnamed
      "nonsense",
    ])).toEqual([{ name: "ok", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]);
  });

  it("clamps points into range and discards non-finite ones", () => {
    const [curve] = normalizeContours([
      { name: "wild", points: [{ x: -3, y: 9 }, { x: Number.NaN, y: 0 }, { x: 0.5, y: 0.5 }] },
    ]);
    expect(curve.points).toEqual([{ x: 0, y: 1 }, { x: 0.5, y: 0.5 }]);
  });

  it("returns an empty library for anything that is not an array", () => {
    expect(normalizeContours(null)).toEqual([]);
    expect(normalizeContours({})).toEqual([]);
  });
});
