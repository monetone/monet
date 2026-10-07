// ─────────────────────────────────────────────────────────────
// frame.ts — pure camera-framing geometry for "Frame Selected".
//
// Unity's Scene view "Frame Selected" (F) centres the view on the current
// selection and zooms so it fills the viewport. The maths is a couple of pure
// functions — given the selection's world bounds and the viewport size, work
// out the camera zoom + world-space centre that frames it. The EditorScene
// supplies the live bounds + viewport and applies the result to the Phaser
// camera; keeping the geometry here makes it framework-free and unit-testable.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned rectangle (top-left origin), world units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameView {
  zoom: number;
  centerX: number;
  centerY: number;
}

export interface FrameOpts {
  /** Screen-space margin (px) kept on every side of the framed box. */
  pad?: number;
  /** Smallest zoom the camera may settle at. */
  minZoom?: number;
  /** Largest zoom the camera may settle at (caps how far it zooms into a
   *  tiny/point-sized selection — mirrors how Unity doesn't zoom infinitely). */
  maxZoom?: number;
}

const DEFAULTS: Required<FrameOpts> = { pad: 56, minZoom: 0.1, maxZoom: 8 };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Axis-aligned bounds of a set of world points, or null if there are none. */
export function boundsOfPoints(pts: Point[]): Rect | null {
  if (pts.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Union of two AABBs; either may be null (the other is returned as-is). */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.w, b.x + b.w);
  const maxY = Math.max(a.y + a.h, b.y + b.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Camera zoom + world centre that frames `box` inside a `viewW × viewH`
 *  viewport, leaving `pad` screen px of margin and clamped to [minZoom, maxZoom].
 *  A zero-size (point) box zooms to `maxZoom`; the centre is always the box's
 *  centre regardless of clamping. */
export function frameView(box: Rect, viewW: number, viewH: number, opts: FrameOpts = {}): FrameView {
  const { pad, minZoom, maxZoom } = { ...DEFAULTS, ...opts };
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;

  const usableW = Math.max(1, viewW - pad * 2);
  const usableH = Math.max(1, viewH - pad * 2);
  const zx = box.w > 1e-6 ? usableW / box.w : Infinity;
  const zy = box.h > 1e-6 ? usableH / box.h : Infinity;

  let zoom = Math.min(zx, zy);
  if (!Number.isFinite(zoom)) zoom = maxZoom; // point-sized selection
  zoom = clamp(zoom, minZoom, maxZoom);

  return { zoom, centerX, centerY };
}

/** The translation that moves the bounding-box centre of `points` onto
 *  `target` — the maths behind "Move to View" (centre the selection in the
 *  viewport). Empty input yields no movement. */
export function centerDelta(points: Point[], target: Point): { dx: number; dy: number } {
  const b = boundsOfPoints(points);
  if (!b) return { dx: 0, dy: 0 };
  return { dx: target.x - (b.x + b.w / 2), dy: target.y - (b.y + b.h / 2) };
}
