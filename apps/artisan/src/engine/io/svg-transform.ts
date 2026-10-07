// ─────────────────────────────────────────────────────────────
// io/svg-transform — parse an SVG transform attribute → Matrix
// ─────────────────────────────────────────────────────────────
// Supports matrix(), translate(), scale(), rotate(a [cx cy]), skewX(), skewY().
// Multiple transforms compose left→right (the SVG convention).

import { IDENTITY, type Matrix, mul, rotation, scaling, shearing, translation, aroundPoint } from "../geometry/matrix";

const FN = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
const nums = (s: string): number[] =>
  s
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));

export function parseTransform(input: string | null | undefined): Matrix {
  if (!input) return IDENTITY;
  let m = IDENTITY;
  let match: RegExpExecArray | null;
  FN.lastIndex = 0;
  while ((match = FN.exec(input))) {
    const fn = match[1];
    const a = nums(match[2]);
    switch (fn) {
      case "matrix":
        if (a.length === 6) m = mul(m, { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] });
        break;
      case "translate":
        m = mul(m, translation(a[0] || 0, a[1] || 0));
        break;
      case "scale":
        m = mul(m, scaling(a[0] ?? 1, a[1] ?? a[0] ?? 1));
        break;
      case "rotate": {
        const rad = ((a[0] || 0) * Math.PI) / 180;
        if (a.length >= 3) m = mul(m, aroundPoint({ x: a[1], y: a[2] }, rotation(rad)));
        else m = mul(m, rotation(rad));
        break;
      }
      case "skewX":
        m = mul(m, shearing(((a[0] || 0) * Math.PI) / 180, 0));
        break;
      case "skewY":
        m = mul(m, shearing(0, ((a[0] || 0) * Math.PI) / 180));
        break;
    }
  }
  return m;
}
