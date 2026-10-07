// ─────────────────────────────────────────────────────────────
// Marquee Style geometry — pure helpers for the Rectangular / Elliptical Marquee
// "Style" option (Photoshop): Normal (free drag, see canvas/marqueeRect), Fixed
// Ratio (lock the width:height aspect) and Fixed Size (an exact W×H px box).
// Engine-free so it unit-tests in node; the canvas wires these to select_rect /
// select_ellipse.
// ─────────────────────────────────────────────────────────────

export type MarqueeStyle = "normal" | "ratio" | "size";

export interface MarqueeRect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export const MAX_FIXED_SIZE = 10_000;

export function normalizeFixedSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_FIXED_SIZE, Math.max(1, Math.round(value)));
}

/**
 * Fixed Ratio: a rect anchored at the gesture start (sx,sy) whose aspect equals
 * ratioW:ratioH, extending toward the live pointer (x,y). The magnitude tracks
 * whichever axis the drag projects further along (so a drag in any direction grows
 * the box), keeping the ratio exactly. Ratio terms <= 0 fall back to 1. Returns an
 * integer top-left rect.
 */
export function fixedRatioRect(
  sx: number, sy: number, x: number, y: number,
  ratioW: number, ratioH: number,
): MarqueeRect {
  const rw = ratioW > 0 ? ratioW : 1;
  const rh = ratioH > 0 ? ratioH : 1;
  const dx = x - sx;
  const dy = y - sy;
  // Width basis = the larger of the horizontal drag and the vertical drag projected
  // onto the ratio, so the box reaches the cursor on either axis.
  const w = Math.max(Math.abs(dx), Math.abs(dy) * (rw / rh));
  const h = w * (rh / rw);
  const x0 = dx < 0 ? sx - w : sx;
  const y0 = dy < 0 ? sy - h : sy;
  return { x0: Math.round(x0), y0: Math.round(y0), w: Math.round(w), h: Math.round(h) };
}

/**
 * Fixed Size: a rect of exactly w×h px anchored at the click. The anchor is kept
 * inside the document, but the requested size may extend beyond it; the selection
 * engine clips the resulting mask without shifting or resizing the geometry.
 */
export function fixedSizeRect(
  clickX: number, clickY: number,
  w: number, h: number,
  canvasW: number, canvasH: number,
): MarqueeRect {
  const rw = normalizeFixedSize(w);
  const rh = normalizeFixedSize(h);
  const x0 = Math.min(Math.max(0, Math.round(clickX)), Math.max(0, Math.round(canvasW) - 1));
  const y0 = Math.min(Math.max(0, Math.round(clickY)), Math.max(0, Math.round(canvasH) - 1));
  return { x0, y0, w: rw, h: rh };
}
