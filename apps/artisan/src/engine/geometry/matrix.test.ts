// ─────────────────────────────────────────────────────────────
// matrix.test — affine 2D transform math (SVG/canvas convention)
// ─────────────────────────────────────────────────────────────
// The geometry layer (matrix/vec/bbox/bezier/path) had no unit coverage, yet
// matrix is the foundation every transform op, the Transform panel (decompose)
// and hit-testing (meanScale) read through. Pin the convention here: a point
// (x,y) maps to x' = a·x + c·y + e, y' = b·x + d·y + f, and mul(m,n) applies n
// first, then m.

import { describe, it, expect } from "vitest";
import { pt, type Point } from "./vec";
import {
  IDENTITY,
  applyToPoint,
  applyToVector,
  aroundPoint,
  compose,
  decompose,
  determinant,
  invert,
  isIdentity,
  matrix,
  meanScale,
  mul,
  rotation,
  scaleM,
  scaling,
  toSVG,
  translate,
  translation,
} from "./matrix";

const expectPoint = (p: Point, x: number, y: number, digits = 9) => {
  expect(p.x).toBeCloseTo(x, digits);
  expect(p.y).toBeCloseTo(y, digits);
};

describe("identity & constructors", () => {
  it("IDENTITY leaves points unchanged", () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expectPoint(applyToPoint(IDENTITY, pt(3, 7)), 3, 7);
  });

  it("isIdentity is false for any non-trivial matrix", () => {
    expect(isIdentity(matrix(1, 0, 0, 1, 0.0001, 0))).toBe(false);
    expect(isIdentity(scaling(2))).toBe(false);
  });
});

describe("primitive transforms", () => {
  it("translation moves points but not vectors", () => {
    const m = translation(3, 4);
    expectPoint(applyToPoint(m, pt(1, 1)), 4, 5);
    expectPoint(applyToVector(m, pt(1, 1)), 1, 1); // linear part is identity
  });

  it("scaling scales coordinates; one arg is uniform", () => {
    expectPoint(applyToPoint(scaling(2, 3), pt(4, 5)), 8, 15);
    expect(scaling(2)).toEqual(scaling(2, 2));
  });

  it("rotation(90°) sends +x to +y", () => {
    expectPoint(applyToPoint(rotation(Math.PI / 2), pt(1, 0)), 0, 1);
    expectPoint(applyToPoint(rotation(Math.PI), pt(1, 0)), -1, 0);
  });
});

describe("composition order", () => {
  it("mul(m, n) applies n first, then m", () => {
    // scale-then-translate: (1,0) → scale×2 → (2,0) → +10x → (12,0)
    expectPoint(applyToPoint(mul(translation(10, 0), scaling(2)), pt(1, 0)), 12, 0);
    // translate-then-scale: (1,0) → +10x → (11,0) → scale×2 → (22,0)
    expectPoint(applyToPoint(mul(scaling(2), translation(10, 0)), pt(1, 0)), 22, 0);
  });

  it("compose() chains left-to-right with identity seed", () => {
    expect(compose()).toEqual(IDENTITY);
    const m = compose(translation(10, 0), scaling(2));
    expectPoint(applyToPoint(m, pt(1, 0)), 12, 0);
  });

  it("the mutating helpers post-multiply (translate(m,…) = m·translation)", () => {
    expect(translate(IDENTITY, 5, 6)).toEqual(translation(5, 6));
    expect(scaleM(IDENTITY, 2, 3)).toEqual(scaling(2, 3));
  });
});

describe("aroundPoint", () => {
  it("pivots a transform about a fixed centre", () => {
    const m = aroundPoint(pt(10, 10), rotation(Math.PI / 2));
    expectPoint(applyToPoint(m, pt(10, 10)), 10, 10); // centre is fixed
    expectPoint(applyToPoint(m, pt(11, 10)), 10, 11); // 1 unit right → 1 unit up of centre
  });
});

describe("determinant & invert", () => {
  it("determinant is the signed area scale", () => {
    expect(determinant(scaling(2, 3))).toBe(6);
    expect(determinant(IDENTITY)).toBe(1);
  });

  it("invert round-trips a point through an affine transform", () => {
    const m = compose(translation(5, 7), scaling(2, 4), rotation(0.6));
    const p = pt(3, -2);
    expectPoint(applyToPoint(invert(m), applyToPoint(m, p)), 3, -2, 6);
    // m · m⁻¹ ≈ identity
    const back = mul(m, invert(m));
    expect(back.a).toBeCloseTo(1, 9);
    expect(back.d).toBeCloseTo(1, 9);
    expect(back.e).toBeCloseTo(0, 9);
    expect(back.f).toBeCloseTo(0, 9);
  });

  it("degrades to IDENTITY for a singular matrix", () => {
    expect(invert(scaling(0, 0))).toEqual(IDENTITY);
  });
});

describe("decompose", () => {
  it("identity decomposes to neutral components", () => {
    const d = decompose(IDENTITY);
    expect(d).toMatchObject({ translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0 });
  });

  it("reads translation and scale", () => {
    expect(decompose(translation(3, 4))).toMatchObject({ translateX: 3, translateY: 4 });
    const s = decompose(scaling(2, 3));
    expect(s.scaleX).toBeCloseTo(2, 9);
    expect(s.scaleY).toBeCloseTo(3, 9);
    expect(s.rotation).toBeCloseTo(0, 9);
    expect(s.skewX).toBeCloseTo(0, 9);
  });

  it("recovers rotation and non-uniform scale from a rotate·scale matrix", () => {
    const d = decompose(compose(rotation(Math.PI / 4), scaling(2, 3)));
    expect(d.rotation).toBeCloseTo(Math.PI / 4, 9);
    expect(d.scaleX).toBeCloseTo(2, 9);
    expect(d.scaleY).toBeCloseTo(3, 9);
    expect(d.skewX).toBeCloseTo(0, 9);
  });

  it("detects an x-skew", () => {
    // shearing(0.3) puts tan(0.3) in slot c → skewX should read back ~0.3
    const d = decompose(matrix(1, 0, Math.tan(0.3), 1, 0, 0));
    expect(d.skewX).toBeCloseTo(0.3, 9);
    expect(d.scaleX).toBeCloseTo(1, 9);
    expect(d.scaleY).toBeCloseTo(1, 9);
    expect(d.rotation).toBeCloseTo(0, 9);
  });
});

describe("meanScale & toSVG", () => {
  it("meanScale is the geometric mean of the axis scales", () => {
    expect(meanScale(scaling(4))).toBeCloseTo(4, 9);
    expect(meanScale(scaling(2, 8))).toBeCloseTo(4, 9); // √(2·8)
    expect(meanScale(IDENTITY)).toBe(1);
    expect(meanScale(scaling(0, 0))).toBe(1); // singular → falls back to 1
  });

  it("toSVG emits the canonical matrix(...) string", () => {
    expect(toSVG(matrix(1, 2, 3, 4, 5, 6))).toBe("matrix(1,2,3,4,5,6)");
  });
});
