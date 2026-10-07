// ─────────────────────────────────────────────────────────────
// vec — 2D point / vector math
// ─────────────────────────────────────────────────────────────
// A Point is both a position and a free vector (delta). All functions are pure
// and return fresh objects; nothing mutates its inputs.

export interface Point {
  x: number;
  y: number;
}

export const pt = (x: number, y: number): Point => ({ x, y });
export const ZERO: Point = { x: 0, y: 0 };

export const clone = (p: Point): Point => ({ x: p.x, y: p.y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const mul = (a: Point, b: Point): Point => ({ x: a.x * b.x, y: a.y * b.y });
export const negate = (a: Point): Point => ({ x: -a.x, y: -a.y });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
/** 2D cross product magnitude (z of the 3D cross). */
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const lenSq = (a: Point): number => a.x * a.x + a.y * a.y;
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const distSq = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const normalize = (a: Point): Point => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

export const withLen = (a: Point, l: number): Point => scale(normalize(a), l);

export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Perpendicular (rotated +90°, i.e. counter-clockwise in screen coords). */
export const perp = (a: Point): Point => ({ x: -a.y, y: a.x });

/** Angle of the vector in radians (atan2). */
export const angle = (a: Point): number => Math.atan2(a.y, a.x);

/** Rotate a vector by `rad` radians around the origin. */
export const rotate = (a: Point, rad: number): Point => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

/** Rotate a point by `rad` radians around `center`. */
export const rotateAround = (a: Point, center: Point, rad: number): Point =>
  add(center, rotate(sub(a, center), rad));

export const equals = (a: Point, b: Point, eps = 1e-9): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Signed angle (radians) from vector a to vector b in [-π, π]. */
export const angleBetween = (a: Point, b: Point): number =>
  Math.atan2(cross(a, b), dot(a, b));

export const round = (a: Point, places = 3): Point => {
  const f = 10 ** places;
  return { x: Math.round(a.x * f) / f, y: Math.round(a.y * f) / f };
};
