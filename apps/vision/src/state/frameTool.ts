// Frame tool (Photoshop's K tool) — pure geometry/mode helpers. The engine owns
// the clipping container (kind=6 with [x,y,w,h,bg,shape] adj_params); these are
// the node-testable leaves the UI uses to turn a drag into a frame and to place
// a dropped image inside one. Kept DOM/WASM-free so they run under vitest.

/** The frame's clip shape: a rectangular or an elliptical container. Mirrors the
 *  Rectangular/Elliptical pair on the Marquee tool. */
export type FrameMode = "rect" | "ellipse";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Below this on either axis a drag is treated as a click, not a frame (matches
 *  the Crop tool's drag threshold). */
export const MIN_FRAME = 3;

/** Normalise a drag from (sx,sy)→(ex,ey) into an integer rect. `square`
 *  constrains to a 1:1 box (Shift) and `fromCenter` grows out from the start
 *  point (Alt) — identical to the marquee's modifier behaviour. */
export function frameRect(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  square: boolean,
  fromCenter: boolean,
): Rect {
  let dx = ex - sx;
  let dy = ey - sy;
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -m : m;
    dy = dy < 0 ? -m : m;
  }
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  let left: number;
  let top: number;
  let w: number;
  let h: number;
  if (fromCenter) {
    left = sx - adx;
    top = sy - ady;
    w = adx * 2;
    h = ady * 2;
  } else {
    left = Math.min(sx, sx + dx);
    top = Math.min(sy, sy + dy);
    w = adx;
    h = ady;
  }
  return { x: Math.round(left), y: Math.round(top), w: Math.round(w), h: Math.round(h) };
}

/** A drag only commits to a frame when it's a real rectangle, not a click. */
export function frameIsValid(w: number, h: number): boolean {
  return w >= MIN_FRAME && h >= MIN_FRAME;
}

/** The layer offset that centres an `imgW`×`imgH` image inside `frame` (the
 *  imported image's content starts at the canvas origin). The engine clips the
 *  member to the frame bounds afterwards. */
export function frameFillOffset(frame: Rect, content: Rect): { dx: number; dy: number } {
  // `set_layer_offset` writes an ABSOLUTE offset, so the content's own origin has
  // to come off: an image with transparent margins (a logo, a PNG sticker) has an
  // alpha bbox that does not start at (0,0), and centring the plane instead of the
  // content landed it off by exactly that origin. Fully opaque photos have origin
  // (0,0) and are unaffected. (#151)
  return {
    dx: Math.round(frame.x + (frame.w - content.w) / 2 - content.x),
    dy: Math.round(frame.y + (frame.h - content.h) / 2 - content.y),
  };
}
