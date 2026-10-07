// ─────────────────────────────────────────────────────────────
// Line arrowheads — pure geometry for the Line tool's arrowhead options
// (Photoshop). The arrowhead is a polygon at the line end pointing outward along
// the line: a triangle (concavity 0) or a concave quad. Width/Length are absolute
// pixels. Engine-free so it unit-tests in node; CanvasView fills the
// returned polygon via select_polygon + fill_selection.
// ─────────────────────────────────────────────────────────────

/**
 * Arrowhead polygon (flat [x,y × 4]: tip, left base, mid-back, right base) at the
 * tip, pointing along the outward direction (dirX,dirY). Width and length are
 * absolute pixels (each clamped to >= 1); the base centre is L back from the
 * tip, the base corners are ± the unit normal × W/2, and the mid-back point shifts
 * toward the tip by L*(concavityPct/100) (positive = concave). A zero-length
 * direction returns [].
 */
export function arrowheadPolygon(
  tipX: number, tipY: number,
  dirX: number, dirY: number,
  widthPx: number, lengthPx: number, concavityPct: number,
): number[] {
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return [];
  const ux = dirX / len, uy = dirY / len; // unit direction toward the tip
  const W = Math.max(1, widthPx);
  const L = Math.max(1, lengthPx);
  const bx = tipX - ux * L, by = tipY - uy * L; // base centre
  const nx = -uy, ny = ux; // unit normal
  const hw = W / 2;
  const leftX = bx + nx * hw, leftY = by + ny * hw;
  const rightX = bx - nx * hw, rightY = by - ny * hw;
  const c = (concavityPct / 100) * L; // mid-back offset toward the tip
  const midX = bx + ux * c, midY = by + uy * c;
  return [tipX, tipY, leftX, leftY, midX, midY, rightX, rightY];
}
