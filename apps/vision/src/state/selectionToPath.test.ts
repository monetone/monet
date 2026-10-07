import { describe, it, expect } from "vitest";
import { selectionToPath, simplifyPath } from "./selectionToPath";

// Build a w*h coverage mask: 255 where inside(x,y), else 0.
function mask(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = inside(x, y) ? 255 : 0;
  return m;
}

// Shoelace area of the closed polygon (first vertex not repeated).
function area(p: number[]) {
  let a = 0;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(a) / 2;
}

function bbox(p: number[]) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    minx = Math.min(minx, p[i]); maxx = Math.max(maxx, p[i]);
    miny = Math.min(miny, p[i + 1]); maxy = Math.max(maxy, p[i + 1]);
  }
  return { minx, miny, maxx, maxy };
}

describe("selectionToPath", () => {
  it("traces a filled rectangle to exactly 4 corners at its pixel-edge box", () => {
    // cells x in [2,7] (6 wide), y in [1,4] (4 tall) → edges x 2..8, y 1..5
    const m = mask(10, 10, (x, y) => x >= 2 && x <= 7 && y >= 1 && y <= 4);
    const path = selectionToPath(m, 10, 10, 1);
    expect(path.length).toBe(8); // 4 corners
    expect(bbox(path)).toEqual({ minx: 2, miny: 1, maxx: 8, maxy: 5 });
  });

  it("returns [] for an empty mask", () => {
    expect(selectionToPath(mask(8, 8, () => false), 8, 8, 1)).toEqual([]);
  });

  it("traces a single inside pixel to a 4-corner unit square", () => {
    const path = selectionToPath(mask(8, 8, (x, y) => x === 3 && y === 3), 8, 8, 0);
    expect(path.length).toBe(8); // 4 corners
    expect(bbox(path)).toEqual({ minx: 3, miny: 3, maxx: 4, maxy: 4 });
  });

  it("traces an L-shaped region to 6 corners (finds the concavity)", () => {
    // vertical bar cols 0..2 all rows, plus a foot cols 0..5 on rows 4..5
    const m = mask(8, 8, (x, y) => (x < 3 && y < 6) || (x < 6 && y >= 4 && y < 6));
    const path = selectionToPath(m, 8, 8, 0);
    expect(path.length).toBe(12); // 6 corners — an L, not a bounding rectangle
    expect(bbox(path)).toEqual({ minx: 0, miny: 0, maxx: 6, maxy: 6 });
  });

  // (#158) A corner that starts TWO cracks (two regions touching only
  // diagonally) used to derail the chain into the other region: the walk never
  // reached the start corner and burned the whole step budget, emitting a
  // self-overlapping corner list (442 vertices, area 1762 for the case below —
  // more than the entire 20×20 document) or nothing at all.
  it("traces only the first region when two squares touch at one corner", () => {
    // 4×4 at [2,5]² and 4×4 at [6,9]², sharing exactly the corner (6,6)
    const m = mask(20, 20, (x, y) =>
      (x >= 2 && x <= 5 && y >= 2 && y <= 5) || (x >= 6 && x <= 9 && y >= 6 && y <= 9));
    const path = selectionToPath(m, 20, 20, 1);
    expect(path.length).toBe(8); // 4 corners, not a 442-vertex tangle
    expect(bbox(path)).toEqual({ minx: 2, miny: 2, maxx: 6, maxy: 6 });
    expect(area(path)).toBe(16); // exactly the first square
  });

  it("ignores a diagonally-attached stray pixel", () => {
    // 12×12 block plus one pixel touching only its bottom-right corner
    const m = mask(32, 32, (x, y) => (x < 12 && y < 12) || (x === 12 && y === 12));
    const path = selectionToPath(m, 32, 32, 0);
    expect(path.length).toBe(8);
    expect(area(path)).toBe(144); // the block, not a 3-vertex degenerate triangle
  });

  it("returns a closed, plausible polygon for a ragged magic-wand-like blob", () => {
    // A disc with a noisy edge — the shape every lasso/wand selection produces,
    // full of single-pixel diagonal connections. This used to return [].
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const m = mask(64, 64, (x, y) => Math.hypot(x - 32, y - 32) + (rnd() - 0.5) * 6 < 21);
    const path = selectionToPath(m, 64, 64, 1);
    expect(path.length).toBeGreaterThanOrEqual(6); // a real path, not []
    expect(area(path)).toBeGreaterThan(100);
    expect(area(path)).toBeLessThanOrEqual(64 * 64); // no self-overlapping tangle
    const b = bbox(path);
    expect(b.minx).toBeGreaterThanOrEqual(0);
    expect(b.miny).toBeGreaterThanOrEqual(0);
    expect(b.maxx).toBeLessThanOrEqual(64);
    expect(b.maxy).toBeLessThanOrEqual(64);
  });

  it("loosens a staircase with a higher tolerance (fewer anchor points)", () => {
    const m = mask(8, 8, (x, y) => x + y < 8); // a 45° diagonal → staircase hypotenuse
    const fine = selectionToPath(m, 8, 8, 0);
    const loose = selectionToPath(m, 8, 8, 1.5);
    expect(fine.length).toBeGreaterThan(loose.length); // tolerance simplifies the steps
    expect(loose.length).toBeGreaterThanOrEqual(6); // still a valid polygon (≥3 corners)
  });
});

describe("simplifyPath", () => {
  it("collapses collinear points but keeps the real corners", () => {
    // a rectangle with a redundant midpoint (1,0) on the top edge
    const out = simplifyPath([0, 0, 1, 0, 2, 0, 2, 2, 0, 2], 0.5);
    expect(out.length).toBe(8); // the collinear (1,0) is dropped → 4 corners
    expect(bbox(out)).toEqual({ minx: 0, miny: 0, maxx: 2, maxy: 2 });
  });

  it("keeps all 3 corners of a triangle", () => {
    expect(simplifyPath([0, 0, 4, 0, 2, 4], 0.5)).toEqual([0, 0, 4, 0, 2, 4]);
  });

  it("returns short inputs unchanged", () => {
    expect(simplifyPath([0, 0, 1, 1], 1)).toEqual([0, 0, 1, 1]);
  });
});
