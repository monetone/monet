// ─────────────────────────────────────────────────────────────
// width-profile.test — variable-width stroke ribbon (Width tool primitive)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Width tool builds a variable-width stroke. The
// ribbon's half-width at each anchor = (per-anchor multiplier × stroke weight) / 2,
// so it is wider where the multiplier is larger.

import { describe, it, expect } from "vitest";
import { Path, makeAnchor as anchor } from "./index";

describe("geometry.path.widthOutline — variable width", () => {
  it("builds a ribbon wider at the high-multiplier anchor", () => {
    const line = { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] };
    const rings = Path.widthOutline(line, [1, 3], 10); // base 10 ⇒ ±5 at anchor0, ±15 at anchor1
    expect(rings.length).toBe(1); // open path → one ribbon ring
    const pts = rings[0].anchors.map((a) => a.point);
    const yAt = (x: number) =>
      pts
        .filter((p) => Math.abs(p.x - x) < 1)
        .map((p) => p.y)
        .sort((a, b) => a - b);
    const narrow = yAt(0); // multiplier 1 → ±5
    const wide = yAt(100); // multiplier 3 → ±15
    expect(narrow[0]).toBeCloseTo(-5);
    expect(narrow[narrow.length - 1]).toBeCloseTo(5);
    expect(wide[0]).toBeCloseTo(-15);
    expect(wide[wide.length - 1]).toBeCloseTo(15);
  });

  it("a uniform profile gives a constant-width band", () => {
    const line = { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] };
    const rings = Path.widthOutline(line, [1, 1], 8); // ±4 everywhere
    const ys = rings[0].anchors.map((a) => Math.abs(a.point.y));
    expect(Math.max(...ys)).toBeCloseTo(4);
  });
});
