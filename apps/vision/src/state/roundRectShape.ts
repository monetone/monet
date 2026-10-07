// ─────────────────────────────────────────────────────────────
// Rounded Rectangle — pure outline geometry for the Shape tool's "roundrect"
// kind. Engine-free so it unit-tests in node; CanvasView fills the returned
// outline via select_polygon + fill_selection.
//
// The outline is traced clockwise as four quarter-circle corner arcs joined by
// the straight sides. Radius is clamped to [0, min(w,h)/2]; radius 0 degenerates
// to a plain rectangle (the 4 corners).
// ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Outline of a rounded rectangle in the box (x0,y0,w,h), as a flat [x,y,…]
 *  polygon. `seg` is the number of segments per corner arc. */
export function roundedRectVertices(
  x0: number,
  y0: number,
  w: number,
  h: number,
  radius: number,
  seg = 6,
): number[] {
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  if (r <= 0) {
    return [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h]; // plain rect
  }
  const out: number[] = [];
  // Each corner is a quarter arc of radius r centred r in from the box edges.
  // Order (clockwise from the top edge): top-right, bottom-right, bottom-left,
  // top-left — joined by the straight sides between consecutive arcs.
  const arc = (cx: number, cy: number, startAngle: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = startAngle + (i / seg) * (Math.PI / 2);
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  arc(x0 + w - r, y0 + r, -Math.PI / 2); // top-right
  arc(x0 + w - r, y0 + h - r, 0); // bottom-right
  arc(x0 + r, y0 + h - r, Math.PI / 2); // bottom-left
  arc(x0 + r, y0 + r, Math.PI); // top-left
  return out;
}
