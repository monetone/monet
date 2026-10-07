// ─────────────────────────────────────────────────────────────
// Transform controls — pure geometry for the Move tool's "Show Transform
// Controls" overlay (Photoshop). Given the active layer's bounding box, returns
// the 8 resize handles (the Free Transform frame) drawn over it. Engine-free so
// it unit-tests in node; the overlay reads the box from engine.active_layer_bounds().
//
// It also carries the affine math behind Edit ▸ Free Transform Path / Transform
// Path — the same frame applied to a Pen work path instead of a layer's pixels.
// ─────────────────────────────────────────────────────────────

import { ANCHOR_STRIDE } from "./paths";

export interface HandlePt {
  x: number;
  y: number;
}

/** The 8 transform handles of a bounding box, in document px — 4 corners + 4 edge
 *  midpoints, ordered clockwise from the top-left: TL, T, TR, R, BR, B, BL, L. */
export function transformHandles(x: number, y: number, w: number, h: number): HandlePt[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const right = x + w;
  const bottom = y + h;
  return [
    { x, y },
    { x: cx, y },
    { x: right, y },
    { x: right, y: cy },
    { x: right, y: bottom },
    { x: cx, y: bottom },
    { x, y: bottom },
    { x, y: cy },
  ];
}

// ── Free Transform Path ──────────────────────────────────────────
// A path transform is a 2×3 affine in the canvas/SVG order [a, b, c, d, e, f]:
//   x' = a·x + c·y + e,   y' = b·x + d·y + f.

export type Affine = readonly [number, number, number, number, number, number];

/** One Free Transform Path step. Every field is optional so the discrete menu
 *  commands read as their one knob ({ deg: 90 }, { sx: -1 }, …). */
export interface PathTransform {
  /** Scale factors, 1 = unchanged. Negative flips (Transform ▸ Flip Horizontal). */
  sx?: number;
  sy?: number;
  /** Rotation in degrees, clockwise on screen (doc y grows downward). */
  deg?: number;
  /** Shear in degrees (Transform ▸ Skew), horizontal and vertical. */
  skewH?: number;
  skewV?: number;
  /** Move in doc px, applied after scale/rotate/skew. */
  tx?: number;
  ty?: number;
}

/** Bounding box of a flat [x0,y0,…] point list; null when it has no points. */
export function pathBounds(flat: number[]): { x: number; y: number; w: number; h: number } | null {
  if (flat.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    minX = Math.min(minX, flat[i]);
    maxX = Math.max(maxX, flat[i]);
    minY = Math.min(minY, flat[i + 1]);
    maxY = Math.max(maxY, flat[i + 1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The matrix for one Free Transform Path step, taken about (cx, cy) —
 *  Photoshop's default centre reference point. Order matches its transform
 *  frame: skew, then scale, then rotate, then move. */
export function pathTransformMatrix(t: PathTransform, cx: number, cy: number): Affine {
  // Sanitize here, not per caller (#163): tan() blows up at ±90° and a zero
  // scale folds the path onto a line — and transformWorkPath takes no history
  // step, so a raw dialog value would destroy the work path unrecoverably.
  const finite = (v: number) => (Number.isFinite(v) ? v : 0);
  const scale = (s: number) => (!Number.isFinite(s) ? 1 : Math.abs(s) >= 1e-3 ? s : 1e-3);
  const shear = (d: number) => Math.max(-89, Math.min(89, finite(d)));
  const sx = scale(t.sx ?? 1), sy = scale(t.sy ?? 1);
  const r = (finite(t.deg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const kh = Math.tan((shear(t.skewH ?? 0) * Math.PI) / 180);
  const kv = Math.tan((shear(t.skewV ?? 0) * Math.PI) / 180);
  // Linear part R · S · K, with K = [[1, kh], [kv, 1]] and S = diag(sx, sy).
  const a = cos * sx - sin * sy * kv;
  const c = cos * sx * kh - sin * sy;
  const b = sin * sx + cos * sy * kv;
  const d = sin * sx * kh + cos * sy;
  // p' = L·(p − C) + C + T, so the translation column absorbs the pivot.
  return [a, b, c, d, cx + finite(t.tx ?? 0) - (a * cx + c * cy), cy + finite(t.ty ?? 0) - (b * cx + d * cy)];
}

/** Transform a flat [x0,y0,…] point list. */
export function transformPoints(flat: number[], m: Affine): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push(m[0] * flat[i] + m[2] * flat[i + 1] + m[4], m[1] * flat[i] + m[3] * flat[i + 1] + m[5]);
  }
  return out;
}

/** Transform an AnchorPath (6 floats per anchor, see paths.ts). The in/out
 *  handles are RELATIVE vectors, so they take the linear part only — adding the
 *  translation to them would move each anchor's curvature off its point. */
export function transformAnchors(anchors: number[], m: Affine): number[] {
  const out = anchors.slice(0, Math.floor(anchors.length / ANCHOR_STRIDE) * ANCHOR_STRIDE);
  for (let o = 0; o < out.length; o += ANCHOR_STRIDE) {
    const x = out[o], y = out[o + 1];
    out[o] = m[0] * x + m[2] * y + m[4];
    out[o + 1] = m[1] * x + m[3] * y + m[5];
    for (const h of [o + 2, o + 4]) {
      const hx = out[h], hy = out[h + 1];
      out[h] = m[0] * hx + m[2] * hy;
      out[h + 1] = m[1] * hx + m[3] * hy;
    }
  }
  return out;
}
