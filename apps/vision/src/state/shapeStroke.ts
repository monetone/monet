// ─────────────────────────────────────────────────────────────
// Shape stroke — pure geometry for the Rectangle / Ellipse shape "Stroke" outline
// (Photoshop). Given the shape rect (x,y,w,h), a stroke width and an alignment, it
// returns the outer and inner bounding rects of the stroke ring. The canvas selects
// the outer rect/ellipse, subtracts the inner one, and fills the ring. Engine-free
// so it unit-tests in node.
// ─────────────────────────────────────────────────────────────

/** Stroke alignment: 0 inside, 1 centre (straddles the edge), 2 outside. */
export type StrokeAlign = 0 | 1 | 2;

export interface SRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StrokeRing {
  outer: SRect;
  inner: SRect; // w/h are 0 when the stroke fills the whole shape (no hole)
}

/** Outer/inner bounding rects of a shape's stroke ring. The outer rect grows the
 *  shape outward by 0 (inside) / width/2 (centre) / width (outside); the inner rect
 *  is the outer inset by `width` on all sides. Integer rects. Returns null for a
 *  non-positive width. */
export function strokeRingRects(x: number, y: number, w: number, h: number, width: number, align: StrokeAlign): StrokeRing | null {
  if (width <= 0) return null;
  const out = align === 2 ? width : align === 1 ? width / 2 : 0;
  const ox = Math.round(x - out), oy = Math.round(y - out);
  const ow = Math.round(w + 2 * out), oh = Math.round(h + 2 * out);
  const iw = ow - 2 * width, ih = oh - 2 * width;
  const hasHole = iw > 0 && ih > 0;
  return {
    outer: { x: ox, y: oy, w: ow, h: oh },
    inner: { x: ox + width, y: oy + width, w: hasHole ? iw : 0, h: hasHole ? ih : 0 },
  };
}
