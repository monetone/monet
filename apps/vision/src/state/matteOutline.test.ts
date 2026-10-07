import { describe, expect, it } from "vitest";
import { douglasPeucker, matteToOutline, MAX_OUTLINE_POINTS } from "./matteOutline";

/** Build a matte from an ASCII grid ('#' = subject). */
function matte(rows: string[]): { m: Uint8Array; w: number; h: number } {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  rows.forEach((row, y) => { for (let x = 0; x < w; x++) if (row[x] === "#") m[y * w + x] = 255; });
  return { m, w, h };
}

/** Build a matte from a predicate ('#' equivalent for curved shapes). */
function shape(w: number, h: number, hit: (x: number, y: number) => boolean): { m: Uint8Array; w: number; h: number } {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hit(x, y)) m[y * w + x] = 255;
  return { m, w, h };
}

const inside = (pts: { x: number; y: number }[], x: number, y: number) => {
  // even-odd point-in-polygon, mirroring the engine's scanline rule
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
      const t = (y - a.y) / (b.y - a.y);
      if (x < a.x + (b.x - a.x) * t) odd = !odd;
    }
  }
  return odd;
};

describe("matteToOutline", () => {
  it("outlines a filled block and contains its interior", () => {
    const g = matte([
      "..........",
      "..######..",
      "..######..",
      "..######..",
      "..######..",
      "..........",
    ]);
    const pts = matteToOutline(g.m, g.w, g.h)!;
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(inside(pts, 0.5, 0.5)).toBe(true);   // block centre
    expect(inside(pts, 0.05, 0.08)).toBe(false); // background corner
  });

  it("traces the LARGEST blob only", () => {
    const g = matte([
      "#.........",
      "..........",
      "...#####..",
      "...#####..",
      "...#####..",
      "..........",
    ]);
    const pts = matteToOutline(g.m, g.w, g.h)!;
    expect(inside(pts, 0.55, 0.55)).toBe(true);  // big blob centre
    expect(inside(pts, 0.05, 0.05)).toBe(false); // lone pixel excluded
  });

  it("preserves a concavity (L shape)", () => {
    const g = matte([
      "########..",
      "########..",
      "###.......",
      "###.......",
      "###.......",
      "###.......",
    ]);
    const pts = matteToOutline(g.m, g.w, g.h, MAX_OUTLINE_POINTS, 0.5)!;
    expect(inside(pts, 0.15, 0.8)).toBe(true);  // vertical arm
    expect(inside(pts, 0.6, 0.15)).toBe(true);  // horizontal arm
    expect(inside(pts, 0.7, 0.7)).toBe(false);  // the notch
  });

  it("traces curved and diagonal subjects, not only axis-aligned ones (#157)", () => {
    // Every real photographic matte is one of these: the topmost-leftmost pixel
    // HAS an inside neighbour below-left, which used to send the tracer into the
    // interior after 3 steps and made matteToOutline return null.
    const cases: [string, ReturnType<typeof shape>][] = [
      ["disc", shape(40, 40, (x, y) => Math.hypot(x - 20, y - 20) <= 10)],
      ["ellipse", shape(40, 40, (x, y) => ((x - 20) / 16) ** 2 + ((y - 20) / 9) ** 2 <= 1)],
      ["diamond", shape(40, 40, (x, y) => Math.abs(x - 20) + Math.abs(y - 20) <= 12)],
    ];
    for (const [name, g] of cases) {
      const pts = matteToOutline(g.m, g.w, g.h);
      expect(pts, name).not.toBeNull();
      expect(pts!.length, name).toBeGreaterThanOrEqual(4); // not a 3-px stub
      expect(inside(pts!, 0.5, 0.5), name).toBe(true);      // centre
      expect(inside(pts!, 0.675, 0.5), name).toBe(true);    // 7 px right of centre
      expect(inside(pts!, 0.5, 0.325), name).toBe(true);    // 7 px above centre
      expect(inside(pts!, 0.05, 0.05), name).toBe(false);   // background corner
    }
  });

  it("returns null for empty or degenerate mattes", () => {
    expect(matteToOutline(new Uint8Array(100), 10, 10)).toBeNull();
    const single = new Uint8Array(100); single[55] = 255;
    expect(matteToOutline(single, 10, 10)).toBeNull(); // 1-px blob < 3 boundary pts
  });

  it("caps the point budget", () => {
    // A big blob's raw boundary trace would explode without the cap.
    const w = 64, h = 64, m = new Uint8Array(w * h);
    for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) m[y * w + x] = 255;
    const pts = matteToOutline(m, w, h, 8, 0)!; // tolerance 0 keeps every vertex, cap 8
    expect(pts.length).toBeLessThanOrEqual(8);
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });
});

describe("douglasPeucker", () => {
  it("collapses collinear chains and keeps corners", () => {
    const chain = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 },
    ];
    const out = douglasPeucker(chain, 0.1);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }]);
  });
});
