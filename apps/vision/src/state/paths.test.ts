import { describe, it, expect } from "vitest";
import {
  hasPath, pathXY, defaultPathName, addPath, removeAt, MAX_PERSISTED_SAVED_PATHS, type SavedPath,
  anchorLoops, workPathPolygon, pullAnchorHandles, flattenAnchorPath, anchorsFromPoints,
  fromPhotoshopPaths, toPhotoshopPaths,
} from "./paths";

// Crossing-number point-in-polygon: the even-odd rule both engine fills use
// (select_polygon's supersampler and tiny-skia's EvenOdd).
function insideEvenOdd(flat: number[], x: number, y: number): boolean {
  let inside = false;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2], yi = flat[i * 2 + 1], xj = flat[j * 2], yj = flat[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const square = (x: number, y: number, s: number) => anchorsFromPoints([x, y, x + s, y, x + s, y + s, x, y + s]);

// A glyph work path is several closed loops: an outline, its counter, the next
// letter. (#452)
describe("multi-loop work paths", () => {
  const OUTER = square(0, 0, 30), HOLE = square(10, 10, 10), APART = square(50, 5, 20);
  const anchors = [...OUTER, ...HOLE, ...APART];

  it("splits anchors by loop and treats malformed or stale counts as one loop", () => {
    expect(anchorLoops(anchors, [4, 4, 4])).toEqual([OUTER, HOLE, APART]);
    for (const bad of [[], [4, 4], [4, 4, 5], [1, 4, 7], [4.5, 3.5, 4], [Number.NaN, 8, 4]]) {
      expect(anchorLoops(anchors, bad)).toEqual([anchors]);
    }
  });

  it("keeps a single loop's polygon identical to its flattening", () => {
    expect(workPathPolygon(OUTER, [])).toEqual(flattenAnchorPath(OUTER));
    expect(workPathPolygon(OUTER, [4])).toEqual(flattenAnchorPath(OUTER));
  });

  it("bridges loops so an even-odd fill keeps counters and gaps empty", () => {
    const poly = workPathPolygon(anchors, [4, 4, 4]);
    expect(insideEvenOdd(poly, 5, 6), "ring, right of the diagonal bridge").toBe(true);
    expect(insideEvenOdd(poly, 15, 15), "counter").toBe(false);
    expect(insideEvenOdd(poly, 40, 4.5), "gap between the letters, left of the bridge").toBe(false);
    expect(insideEvenOdd(poly, 60, 15), "second letter").toBe(true);
  });
});

describe("pullAnchorHandles", () => {
  it("pulls either handle end and mirrors as an exact negation", () => {
    const a = [10, 10, 1, 1, 1, 1, 20, 20, 1, 1, 2, 2];
    pullAnchorHandles(a, 1, 25, 18, true, "in");
    expect(a.slice(6)).toEqual([20, 20, 5, -2, -5, 2]);
    pullAnchorHandles(a, 1, 21, 23, false, "in");
    expect(a.slice(6)).toEqual([20, 20, 1, 3, -5, 2]);
    pullAnchorHandles(a, 0, 13, 14); // the Pen's default: out end, mirrored
    expect(a.slice(0, 6)).toEqual([10, 10, -3, -4, 3, 4]);
  });
});

// The engine's Photoshop path courier (PSD resources 2000+/2999, #457).
describe("toPhotoshopPaths / fromPhotoshopPaths", () => {
  const CURVE = [0, 0, 0, 0, 2, 2, 5, 5, -2, 0, 2, 0, 10, 0, -2, 2, 0, 0];
  // A saved glyph path: two corner loops that only mean something together (#452).
  const GLYPHS = [...square(0, 0, 30), ...square(10, 10, 10)];
  const saved: SavedPath[] = [
    { name: "Path 1", path: [0, 0, 10, 0, 10, 10] },
    { name: "Path 2", path: flattenAnchorPath(CURVE), anchors: CURVE, clipFlatness: 2 },
    { name: "Glyphs", path: workPathPolygon(GLYPHS, [4, 4]), anchors: GLYPHS, contours: [4, 4] },
  ];

  it("sends corner paths as zero-handle anchors and keeps curves, loops and the clipping flatness", () => {
    expect(toPhotoshopPaths(saved)).toEqual([
      { name: "Path 1", anchors: [0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0], clip: null },
      { name: "Path 2", anchors: CURVE, clip: 2 },
      { name: "Glyphs", anchors: GLYPHS, clip: null, contours: [4, 4] },
    ]);
  });

  it("reads imported paths back as saved paths, re-flattened from their anchors", () => {
    expect(fromPhotoshopPaths(JSON.stringify(toPhotoshopPaths(saved)))).toEqual(saved);
  });

  it("reads malformed courier output as no paths", () => {
    for (const bad of ["not json", "{}", "null", 0, undefined]) expect(fromPhotoshopPaths(bad)).toEqual([]);
    expect(fromPhotoshopPaths(JSON.stringify([{ name: 1, anchors: [] }, { name: "no anchors" }, null]))).toEqual([]);
  });
});

describe("hasPath", () => {
  it("requires at least 3 vertices (6 numbers)", () => {
    expect(hasPath([])).toBe(false);
    expect(hasPath([0, 0, 1, 1])).toBe(false); // 2 vertices
    expect(hasPath([0, 0, 1, 0, 1, 1])).toBe(true); // 3 vertices
  });
});

describe("pathXY", () => {
  it("splits a flat path into x/y lists", () => {
    expect(pathXY([10, 20, 30, 40, 50, 60])).toEqual({ xs: [10, 30, 50], ys: [20, 40, 60] });
  });
  it("ignores a dangling odd coordinate", () => {
    expect(pathXY([1, 2, 3])).toEqual({ xs: [1], ys: [2] });
  });
});

describe("defaultPathName", () => {
  it("returns the first free Path N", () => {
    expect(defaultPathName([])).toBe("Path 1");
    expect(defaultPathName(["Path 1", "Path 2"])).toBe("Path 3");
    expect(defaultPathName(["Path 2"])).toBe("Path 1"); // fills the gap
  });
});

describe("addPath / removeAt (immutable)", () => {
  const base: SavedPath[] = [{ name: "Path 1", path: [0, 0, 1, 0, 1, 1] }];
  it("appends without mutating", () => {
    const next = addPath(base, { name: "Path 2", path: [2, 2, 3, 3, 4, 4] });
    expect(next).toHaveLength(2);
    expect(base).toHaveLength(1); // original untouched
  });
  it("refuses entries the document clone cannot preserve", () => {
    const full = Array.from({ length: MAX_PERSISTED_SAVED_PATHS }, (_, i) => ({ ...base[0], name: `Path ${i}` }));
    expect(addPath(full, { ...base[0], name: "Too many" })).toBe(full);
  });
  it("removes by index without mutating", () => {
    const two = addPath(base, { name: "Path 2", path: [] });
    const next = removeAt(two, 0);
    expect(next).toEqual([{ name: "Path 2", path: [] }]);
    expect(two).toHaveLength(2);
  });
});
