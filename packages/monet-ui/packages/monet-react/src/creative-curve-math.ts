// ─────────────────────────────────────────────────────────────
// Monet — pure curve math (no React, no DOM)
// ─────────────────────────────────────────────────────────────
// The geometry behind the SVG bezier curve editors (creative-curve.tsx): value
// ⇄ axis-fraction mapping (linear + log), the smooth path `d` builder, and the
// cubic-bezier sampler used by the easing handles. Kept in a plain `.ts` sibling
// (mirroring creative-color-math.ts) so `node --test` can exercise it directly —
// the runner rejects `.tsx`, and all of this is geometry, not rendering.
//
// This module has NO relative imports on purpose (like creative-color-math.ts):
// the node:test runner resolves the literal specifier and can't follow Vite's
// extensionless `./internal`. `clamp` mirrors the internal helper, kept local.

/** Clamp `n` to the inclusive [min, max] range (mirrors internal.clamp). */
function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

export type CurveScale = "linear" | "log";
export type Vec2 = { x: number; y: number };

/** One editable point on a `CurveEditor`. `x`/`y` are normalised 0..1 (mapped
 *  onto `xRange`/`yRange` for display); `hIn`/`hOut` are optional bezier handle
 *  offsets in the same normalised space (smooth curve through the point). */
export interface CurvePoint {
  id: string;
  /** Normalised position along the X axis, 0..1. */
  x: number;
  /** Normalised position along the Y axis, 0..1. */
  y: number;
  /** Optional per-point swatch (e.g. an EQ band color). */
  color?: string;
  /** Incoming bezier handle, normalised offset from the point. */
  hIn?: Vec2;
  /** Outgoing bezier handle, normalised offset from the point. */
  hOut?: Vec2;
}

/** Map a normalised 0..1 fraction onto a `[lo,hi]` value range. `log` spaces the
 *  fraction geometrically (for frequency axes); both bounds must be > 0 for log,
 *  else it falls back to linear. */
export function fracToValue(
  frac: number,
  lo: number,
  hi: number,
  scale: CurveScale = "linear",
): number {
  const f = clamp(frac, 0, 1);
  if (scale === "log" && lo > 0 && hi > 0) {
    const l0 = Math.log(lo);
    const l1 = Math.log(hi);
    return Math.exp(l0 + (l1 - l0) * f);
  }
  return lo + (hi - lo) * f;
}

/** Inverse of {@link fracToValue}: a value in `[lo,hi]` → its normalised 0..1
 *  fraction (log-aware). Returns a clamped fraction. */
export function valueToFrac(
  value: number,
  lo: number,
  hi: number,
  scale: CurveScale = "linear",
): number {
  if (scale === "log" && lo > 0 && hi > 0 && value > 0) {
    const l0 = Math.log(lo);
    const l1 = Math.log(hi);
    const span = l1 - l0 || 1;
    return clamp((Math.log(value) - l0) / span, 0, 1);
  }
  const span = hi - lo || 1;
  return clamp((value - lo) / span, 0, 1);
}

/** Format a mapped axis value for an `aria-valuetext` — integers stay integral,
 *  large magnitudes drop their decimals, small ones keep two. The value is first
 *  rounded to 4dp so log-mapping float dust (`exp(log(20))` = `20.0000000004`)
 *  still reads as a clean integer. */
export function formatAxisValue(value: number): string {
  const v = Math.round(value * 1e4) / 1e4;
  const abs = Math.abs(v);
  if (Number.isInteger(v)) return String(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/** Project a normalised point onto SVG pixel space. Y is flipped (SVG y grows
 *  downward, our `y` grows upward). */
export function pointToSvg(p: Vec2, width: number, height: number): Vec2 {
  return { x: clamp(p.x, 0, 1) * width, y: (1 - clamp(p.y, 0, 1)) * height };
}

/** Sort points by X without mutating the input (display order is left→right). */
export function sortByX<T extends { x: number }>(points: readonly T[]): T[] {
  return [...points].sort((a, b) => a.x - b.x);
}

/** Build the open curve `d` (no fill close) through `points` in SVG pixel space.
 *  When a segment's endpoints carry handles (`hOut`/`hIn`) a cubic `C` is used,
 *  otherwise a monotone-ish smooth `C` is synthesised from the neighbours
 *  (Catmull-Rom→bezier) so N-point curves read as smooth, not polylines. */
export function buildCurvePath(
  points: readonly CurvePoint[],
  width: number,
  height: number,
  smoothing = 0.2,
): string {
  const pts = sortByX(points);
  if (pts.length === 0) return "";
  const sp = pts.map((p) => pointToSvg(p, width, height));
  if (pts.length === 1) return `M ${fmt(sp[0].x)} ${fmt(sp[0].y)}`;

  let d = `M ${fmt(sp[0].x)} ${fmt(sp[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const pa = sp[i];
    const pb = sp[i + 1];
    // Explicit handles win; otherwise synthesise control points from neighbours.
    const c1 = a.hOut
      ? pointToSvg({ x: a.x + a.hOut.x, y: a.y + a.hOut.y }, width, height)
      : controlPoint(sp[i - 1] ?? pa, pa, pb, false, smoothing);
    const c2 = b.hIn
      ? pointToSvg({ x: b.x + b.hIn.x, y: b.y + b.hIn.y }, width, height)
      : controlPoint(pa, pb, sp[i + 2] ?? pb, true, smoothing);
    d += ` C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(pb.x)} ${fmt(pb.y)}`;
  }
  return d;
}

/** Close an open curve `d` down to the baseline and back for an area fill. */
export function closeFillPath(curve: string, width: number, height: number): string {
  if (!curve) return "";
  return `${curve} L ${fmt(width)} ${fmt(height)} L 0 ${fmt(height)} Z`;
}

/** Sample a CSS cubic-bezier `[x1,y1,x2,y2]` (control points; endpoints fixed at
 *  0,0 and 1,1) into an SVG `d` over `n` segments. The curve is parameterised by
 *  `t`, matching how the browser evaluates `cubic-bezier()`. */
export function easingPath(
  bezier: readonly [number, number, number, number],
  width: number,
  height: number,
  n = 24,
): string {
  const [x1, y1, x2, y2] = bezier;
  const pt = (t: number): Vec2 => {
    const u = 1 - t;
    // P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1)
    const bx = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    const by = 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    return { x: bx * width, y: (1 - by) * height };
  };
  let d = "";
  for (let i = 0; i <= n; i++) {
    const p = pt(i / n);
    d += `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)} `;
  }
  return d.trim();
}

/** Named CSS easing presets as `[x1,y1,x2,y2]` control points. */
export const EASING_PRESETS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/** Match a bezier to a known preset name (within `eps`), else `undefined`. */
export function matchPreset(
  bezier: readonly [number, number, number, number],
  eps = 0.001,
): string | undefined {
  for (const [name, p] of Object.entries(EASING_PRESETS)) {
    if (p.every((v, i) => Math.abs(v - bezier[i]) <= eps)) return name;
  }
  return undefined;
}

// ─── internals ─────────────────────────────────────────────────

/** Round to 2dp for compact, stable path strings (avoids float dust in tests). */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Catmull-Rom→bezier control point at `current`, pointing along the chord
 *  between its NEIGHBOURS (`prev`→`next`) — that is what makes the tangent
 *  continuous across the join, and what makes the segment curve at all. Taking
 *  the direction from the segment's own chord instead puts both of a cubic's
 *  controls ON that chord, collapsing every "curve" to a straight line. */
function controlPoint(
  prev: Vec2,
  current: Vec2,
  next: Vec2,
  reverse: boolean,
  smoothing: number,
): Vec2 {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) + (reverse ? Math.PI : 0);
  const dist = len * smoothing;
  return {
    x: current.x + Math.cos(angle) * dist,
    y: current.y + Math.sin(angle) * dist,
  };
}
