// ─────────────────────────────────────────────────────────────
// ui/transform-ref — Transform panel 9-point reference (origin) proxy
// ─────────────────────────────────────────────────────────────
// Illustrator's Transform panel has a 3×3 reference-point grid: it decides which
// point of the selection bounds the X/Y fields report, and which point W/H scale
// around. This is the pure geometry behind that proxy.

import type { Point, Rect } from "../engine";

export type RefPoint = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";

// Row-major (top→bottom, left→right) — matches the Illustrator proxy layout.
export const REF_POINTS: RefPoint[] = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];

// Fractions along each axis for the row (t/m/b) and column (l/c/r) chars.
const FRAC: Record<string, number> = { t: 0, l: 0, m: 0.5, c: 0.5, b: 1, r: 1 };

/** World position of the chosen reference anchor on a bounds rect. */
export const refAnchor = (b: Rect, ref: RefPoint): Point => ({
  x: b.x + FRAC[ref[1]] * b.width, // column → x
  y: b.y + FRAC[ref[0]] * b.height, // row → y
});
