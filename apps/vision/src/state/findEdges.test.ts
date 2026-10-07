// Unit tests for the Find Edges filter. Engine-free (node). These pin the Sobel gradient
// (must match filters.rs find_edges gx/gy), the inverted magnitude output
// (65535 − min(√(gx²+gy²), 65535)), and the defining behaviour: flat regions go WHITE
// and only edges survive (dark) — the opposite of a blur.
import { describe, it, expect } from "vitest";
import { sobelGx, sobelGy, edgeMagnitude, findEdges2D, FIND_EDGES_MAX } from "./findEdges";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("sobelGx / sobelGy", () => {
  it("are 0 on a flat field", () => {
    const g = grid(3, 3, () => 5000);
    expect(sobelGx(g, 1, 1)).toBe(0);
    expect(sobelGy(g, 1, 1)).toBe(0);
  });

  it("a vertical edge has horizontal gradient only", () => {
    const g = [
      [0, 0, 100],
      [0, 0, 100],
      [0, 0, 100],
    ];
    expect(sobelGx(g, 1, 1)).toBe(400); // right col (100·4) − left col (0)
    expect(sobelGy(g, 1, 1)).toBe(0);
  });

  it("a horizontal edge has vertical gradient only", () => {
    const g = [
      [0, 0, 0],
      [0, 0, 0],
      [100, 100, 100],
    ];
    expect(sobelGx(g, 1, 1)).toBe(0);
    expect(sobelGy(g, 1, 1)).toBe(400); // bottom row (100·4) − top row (0)
  });

  it("matches a hand-computed general 3×3", () => {
    const g = [
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
    ];
    expect(sobelGx(g, 1, 1)).toBe(80); // −10−80−70 +30+120+90
    expect(sobelGy(g, 1, 1)).toBe(240); // −10−40−30 +70+160+90
  });

  it("edge-clamps the neighbourhood at the border", () => {
    // corner (0,0): clamped taps replicate, a flat field still gives 0
    const g = grid(4, 4, () => 1234);
    expect(sobelGx(g, 0, 0)).toBe(0);
    expect(sobelGy(g, 0, 0)).toBe(0);
  });
});

describe("edgeMagnitude", () => {
  it("is the Euclidean gradient magnitude", () => {
    expect(edgeMagnitude(0, 0)).toBe(0);
    expect(edgeMagnitude(3, 4)).toBeCloseTo(5, 5); // 3-4-5
    expect(edgeMagnitude(400, 0)).toBeCloseTo(400, 4);
    expect(edgeMagnitude(80, 240)).toBeCloseTo(Math.sqrt(64000), 2);
  });

  it("clamps at 65535", () => {
    expect(edgeMagnitude(100000, 0)).toBe(FIND_EDGES_MAX);
    expect(edgeMagnitude(262140, 0)).toBe(FIND_EDGES_MAX); // a 0↔65535 edge saturates
  });
});

describe("findEdges2D", () => {
  it("turns a flat image entirely white (the defining property — opposite of a blur)", () => {
    const g = grid(5, 5, () => 30000);
    expect(findEdges2D(g).every((row) => row.every((v) => v === FIND_EDGES_MAX))).toBe(true);
  });

  it("inverts the magnitude: a mild vertical edge darkens slightly", () => {
    const g = [
      [0, 0, 100],
      [0, 0, 100],
      [0, 0, 100],
    ];
    // centre: gx=400, gy=0 → mag 400 → out 65535−400 = 65135
    expect(findEdges2D(g)[1][1]).toBe(65135);
  });

  it("darkens a strong vertical edge to black at the boundary, white elsewhere", () => {
    const g = grid(5, 5, (x) => (x < 2 ? 0 : FIND_EDGES_MAX)); // cols 0,1=0, 2..4=white
    const out = findEdges2D(g);
    for (let y = 0; y < 5; y++) {
      expect(out[y][1]).toBe(0); // boundary columns saturate → black
      expect(out[y][2]).toBe(0);
      expect(out[y][0]).toBe(FIND_EDGES_MAX); // flat interiors → white
      expect(out[y][3]).toBe(FIND_EDGES_MAX);
      expect(out[y][4]).toBe(FIND_EDGES_MAX);
    }
  });

  it("detects a strong horizontal edge too (gy), by symmetry", () => {
    const g = grid(5, 5, (_x, y) => (y < 2 ? 0 : FIND_EDGES_MAX));
    const out = findEdges2D(g);
    for (let x = 0; x < 5; x++) {
      expect(out[1][x]).toBe(0);
      expect(out[2][x]).toBe(0);
      expect(out[0][x]).toBe(FIND_EDGES_MAX);
      expect(out[3][x]).toBe(FIND_EDGES_MAX);
      expect(out[4][x]).toBe(FIND_EDGES_MAX);
    }
  });

  it("keeps every output a valid 16-bit value in [0, 65535]", () => {
    const g = grid(7, 9, (x, y) => (x * 6151 + y * 3079) % FIND_EDGES_MAX);
    for (const v of flat(findEdges2D(g))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(FIND_EDGES_MAX);
    }
  });

  it("handles an empty image and is deterministic", () => {
    expect(findEdges2D([])).toEqual([]);
    expect(findEdges2D([[], []])).toEqual([[], []]);
    const g = grid(6, 6, (x, y) => (x * 53 + y * 97) % 40000);
    expect(findEdges2D(g)).toEqual(findEdges2D(g));
  });

  it("does not mutate the input", () => {
    const g = grid(5, 5, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    findEdges2D(g);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(3, 8, (x, y) => (x * 11 + y * 5) % 50000);
    const out = findEdges2D(g);
    expect(out.length).toBe(3);
    expect(out.every((row) => row.length === 8)).toBe(true);
  });

  it("handles degenerate single-row / 1×1 images (clamped axis has zero gradient)", () => {
    const row = [[0, 0, 100, 100]];
    for (let x = 0; x < 4; x++) expect(sobelGy(row, x, 0)).toBe(0); // top=bottom (one row)
    const out = findEdges2D(row);
    expect(out).toEqual([[FIND_EDGES_MAX, 65135, 65135, FIND_EDGES_MAX]]); // gx=400 at the edges
    expect(findEdges2D([[5000]])).toEqual([[FIND_EDGES_MAX]]); // 1×1 → no gradient → white
  });

  it("rings a lone bright impulse with darker edge pixels", () => {
    const g = grid(7, 7, (x, y) => (x === 3 && y === 3 ? FIND_EDGES_MAX : 0));
    const out = findEdges2D(g);
    expect(out[3][3]).toBe(FIND_EDGES_MAX); // the impulse centre: symmetric → gx=gy=0 → white
    // its 4-neighbours sit on the gradient → darkened below white
    expect(out[2][3]).toBeLessThan(FIND_EDGES_MAX);
    expect(out[3][2]).toBeLessThan(FIND_EDGES_MAX);
  });
});

// ── Several fixtures swept for in-range, shape, and flat→white ────────────────
const FIXTURES: { name: string; image: number[][] }[] = [
  { name: "flat", image: grid(6, 6, () => 22000) },
  { name: "vertical bands", image: grid(6, 8, (x) => (x % 3 === 0 ? 60000 : 5000)) },
  { name: "gradient", image: grid(7, 7, (x, y) => (x + y) * 3000) },
  { name: "checkerboard", image: grid(6, 6, (x, y) => ((x + y) % 2 ? 65535 : 0)) },
];

describe.each(FIXTURES)("fixture: $name", ({ name, image }) => {
  it("stays in range and keeps its shape", () => {
    const out = findEdges2D(image);
    expect(out.length).toBe(image.length);
    expect(out.every((row) => row.length === image[0].length)).toBe(true);
    for (const v of flat(out)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(FIND_EDGES_MAX);
    }
    if (name === "flat") expect(out.every((row) => row.every((v) => v === FIND_EDGES_MAX))).toBe(true);
  });
});
