// ─────────────────────────────────────────────────────────────
// bbox — axis-aligned bounding rectangles
// ─────────────────────────────────────────────────────────────

import { applyToPoint, type Matrix } from "./matrix";
import type { Point } from "./vec";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

export const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const left = (r: Rect): number => r.x;
export const top = (r: Rect): number => r.y;
export const right = (r: Rect): number => r.x + r.width;
export const bottom = (r: Rect): number => r.y + r.height;
export const centerX = (r: Rect): number => r.x + r.width / 2;
export const centerY = (r: Rect): number => r.y + r.height / 2;
export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
export const area = (r: Rect): number => r.width * r.height;
export const isEmpty = (r: Rect): boolean => r.width <= 0 || r.height <= 0;

export const fromPoints = (points: Point[]): Rect => {
  if (points.length === 0) return { ...EMPTY };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const fromTwoPoints = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

export const corners = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];

export const union = (a: Rect | null, b: Rect | null): Rect => {
  if (!a) return b ? { ...b } : { ...EMPTY };
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.width, b.x + b.width);
  const bo = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: r - x, height: bo - y };
};

export const unionAll = (rects: Rect[]): Rect | null =>
  rects.reduce<Rect | null>((acc, r) => union(acc, r), null);

export const intersection = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bo = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || bo <= y) return null;
  return { x, y, width: r - x, height: bo - y };
};

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const containsPoint = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

export const containsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export const inflate = (r: Rect, dx: number, dy = dx): Rect => ({
  x: r.x - dx,
  y: r.y - dy,
  width: r.width + dx * 2,
  height: r.height + dy * 2,
});

export const fromCenter = (cx: number, cy: number, w: number, h: number): Rect => ({
  x: cx - w / 2,
  y: cy - h / 2,
  width: w,
  height: h,
});

/** Transform a rect by a matrix, returning the AABB of the transformed corners. */
export const transform = (r: Rect, m: Matrix): Rect => fromPoints(corners(r).map((p) => applyToPoint(m, p)));
