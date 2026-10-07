// ─────────────────────────────────────────────────────────────
// matrix — affine 2D transform (SVG / canvas convention)
// ─────────────────────────────────────────────────────────────
// A matrix [a b c d e f] maps a point (x, y) to:
//     x' = a·x + c·y + e
//     y' = b·x + d·y + f
// which is exactly the SVG `matrix(a,b,c,d,e,f)` / Canvas `setTransform` order.

import type { Point } from "./vec";

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const matrix = (a: number, b: number, c: number, d: number, e: number, f: number): Matrix => ({ a, b, c, d, e, f });

export const isIdentity = (m: Matrix): boolean =>
  m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;

/** Compose two matrices: `mul(m, n)` applies `n` first, then `m` (m·n). */
export const mul = (m: Matrix, n: Matrix): Matrix => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});

/** Compose a chain left-to-right: `compose(A, B, C)` = A·B·C (A outermost). */
export const compose = (...ms: Matrix[]): Matrix => ms.reduce(mul, IDENTITY);

export const translation = (tx: number, ty: number): Matrix => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });

export const scaling = (sx: number, sy: number = sx): Matrix => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });

export const rotation = (rad: number): Matrix => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
};

/** Shear in radians (skewX, skewY). */
export const shearing = (radX: number, radY = 0): Matrix => ({
  a: 1,
  b: Math.tan(radY),
  c: Math.tan(radX),
  d: 1,
  e: 0,
  f: 0,
});

export const translate = (m: Matrix, tx: number, ty: number): Matrix => mul(m, translation(tx, ty));
export const scaleM = (m: Matrix, sx: number, sy: number = sx): Matrix => mul(m, scaling(sx, sy));
export const rotateM = (m: Matrix, rad: number): Matrix => mul(m, rotation(rad));

/** A transform that applies `m` but pivoted around `center` (in the same space as m's output). */
export const aroundPoint = (center: Point, m: Matrix): Matrix =>
  compose(translation(center.x, center.y), m, translation(-center.x, -center.y));

export const determinant = (m: Matrix): number => m.a * m.d - m.b * m.c;

export const invert = (m: Matrix): Matrix => {
  const det = determinant(m);
  if (Math.abs(det) < 1e-12) return IDENTITY; // singular — degrade gracefully
  const id = 1 / det;
  return {
    a: m.d * id,
    b: -m.b * id,
    c: -m.c * id,
    d: m.a * id,
    e: (m.c * m.f - m.d * m.e) * id,
    f: (m.b * m.e - m.a * m.f) * id,
  };
};

/** Apply the full transform (with translation) to a point. */
export const applyToPoint = (m: Matrix, p: Point): Point => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
});

/** Apply only the linear part (no translation) — for deltas / handle vectors. */
export const applyToVector = (m: Matrix, v: Point): Point => ({
  x: m.a * v.x + m.c * v.y,
  y: m.b * v.x + m.d * v.y,
});

export const toSVG = (m: Matrix): string => `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;

export interface Decomposition {
  translateX: number;
  translateY: number;
  rotation: number; // radians
  scaleX: number;
  scaleY: number;
  skewX: number; // radians
}

/** Decompose into translate · rotate · skewX · scale (QR-style). */
export const decompose = (m: Matrix): Decomposition => {
  const { a, b, c, d, e, f } = m;
  const scaleX = Math.hypot(a, b);
  const rot = Math.atan2(b, a);
  // remove rotation to read skew/scaleY
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cc = a * cos + b * sin;
  const dd = c * cos + d * sin; // = scaleX*skew? handled below
  const c2 = c * -sin + d * cos;
  const scaleY = c2;
  const skewX = Math.atan2(dd, cc === 0 ? 1 : scaleX);
  return {
    translateX: e,
    translateY: f,
    rotation: rot,
    scaleX,
    scaleY,
    skewX,
  };
};

/** Average scale factor (used to keep stroke widths / handle hit radii sane). */
export const meanScale = (m: Matrix): number => Math.sqrt(Math.abs(determinant(m))) || 1;
