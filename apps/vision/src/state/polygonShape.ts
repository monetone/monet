// ─────────────────────────────────────────────────────────────
// Polygon shape — pure vertex geometry for the Shape tool's "polygon" kind
// (Photoshop's Polygon tool). Engine-free so it unit-tests in node; CanvasView
// fills the returned polygon via select_polygon + fill_selection.
//
// A regular polygon has `sides` vertices on the bounding ellipse (rx,ry). A star
// has 2·sides vertices alternating between the outer radius and an inner radius
// (rx·indent, ry·indent). The default rotation puts the first vertex at the top
// (cx, cy−ry), matching Photoshop's upright polygons/stars.
// ─────────────────────────────────────────────────────────────

export const POLYGON_MIN_SIDES = 3;
export const POLYGON_MAX_SIDES = 24;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Vertices of a regular polygon (or star) inscribed in the ellipse centred at
 *  (cx,cy) with radii (rx,ry), as a flat [x0,y0,x1,y1,…] list. */
export function polygonVertices(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  star = false,
  indent = 0.5,
  rotation = -Math.PI / 2,
): number[] {
  const n = clamp(Math.round(sides), POLYGON_MIN_SIDES, POLYGON_MAX_SIDES);
  const inner = clamp(indent, 0.01, 1);
  const count = star ? n * 2 : n;
  const step = (Math.PI * 2) / count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Star alternates outer (even i) and inner (odd i) radii.
    const f = star && i % 2 === 1 ? inner : 1;
    const a = rotation + i * step;
    out.push(cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f);
  }
  return out;
}
