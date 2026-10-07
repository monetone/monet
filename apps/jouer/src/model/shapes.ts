// ─────────────────────────────────────────────────────────────
// shapes.ts — pure vertex geometry for polygonal shape kinds. Shared by the
// live editor (runtime.ts), the multi-engine player and the Phaser code export
// so the shape's outline is defined in exactly one place. Framework-free.
// ─────────────────────────────────────────────────────────────

/** Point-top hexagon inscribed in a `w`×`h` box, as a flat `[x0,y0,x1,y1,…]`
 *  list with the box's top-left at the local origin (0,0). Mirrors Unity's 2D
 *  "Hexagon Point-Top" sprite: a point at the top and bottom, with vertical left
 *  and right edges. Stretches to fill the box (like the ellipse) — the vertical
 *  edges span h/2 and the slanted edges are slightly longer, so a square box
 *  yields a near-regular (not perfectly regular) hexagon. */
export function hexagonPoints(w: number, h: number): number[] {
  return [
    w / 2, 0,           // top apex
    w, h / 4,           // upper-right
    w, (h * 3) / 4,     // lower-right
    w / 2, h,           // bottom apex
    0, (h * 3) / 4,     // lower-left
    0, h / 4,           // upper-left
  ];
}

/** Flat-top hexagon inscribed in a `w`×`h` box, as a flat `[x0,y0,x1,y1,…]` list
 *  with the box's top-left at the local origin (0,0). Mirrors Unity's 2D "Hexagon
 *  Flat-Top" sprite: flat top + bottom edges, with a point at the left and right
 *  (the 90°-rotated counterpart of hexagonPoints). Stretches to fill the box. */
export function hexagonFlatPoints(w: number, h: number): number[] {
  return [
    w / 4, 0,           // upper-left
    (w * 3) / 4, 0,     // upper-right
    w, h / 2,           // right apex
    (w * 3) / 4, h,     // lower-right
    w / 4, h,           // lower-left
    0, h / 2,           // left apex
  ];
}

/** Isometric diamond (rhombus) inscribed in a `w`×`h` box, as a flat
 *  `[x0,y0,x1,y1,…]` list with the box's top-left at the local origin (0,0).
 *  Mirrors Unity's 2D "Isometric Diamond" sprite: vertices at the midpoint of
 *  each box edge (top, right, bottom, left), so it fills the box exactly and a
 *  square box yields a square rotated 45°. */
export function diamondPoints(w: number, h: number): number[] {
  return [
    w / 2, 0,     // top
    w, h / 2,     // right
    w / 2, h,     // bottom
    0, h / 2,     // left
  ];
}

/** Capsule / stadium inscribed in a `w`×`h` box, as a flat `[x0,y0,x1,y1,…]`
 *  list with the box's top-left at the local origin (0,0). Mirrors Unity's 2D
 *  "Capsule" sprite: a rectangle capped by two semicircles of radius
 *  r = min(w,h)/2 — horizontal caps (left/right) when the box is wider than tall,
 *  vertical caps (top/bottom) otherwise. Each cap is sampled with `seg` segments
 *  so the path's AABB fills the box exactly (it lines up with the other
 *  box-defined shapes under the centred 0.5/0.5 origin). A square box yields a
 *  circle. */
export function capsulePoints(w: number, h: number, seg = 8): number[] {
  const r = Math.min(w, h) / 2;
  const pts: number[] = [];
  const arc = (cx: number, cy: number, a0: number, a1: number): void => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  };
  const HALF_PI = Math.PI / 2;
  if (w >= h) {
    // Horizontal: right cap (top→right→bottom) then left cap (bottom→left→top).
    arc(w - r, h / 2, -HALF_PI, HALF_PI);
    arc(r, h / 2, HALF_PI, 3 * HALF_PI);
  } else {
    // Vertical: bottom cap (right→bottom→left) then top cap (left→top→right).
    arc(w / 2, h - r, 0, Math.PI);
    arc(w / 2, r, Math.PI, 2 * Math.PI);
  }
  // Snap near-zero/whole values so the AABB lands exactly on the box edges
  // (cos/sin of ±90°/180° carry tiny float error that would jitter the bounds).
  return pts.map((n) => {
    const rounded = Math.round(n);
    return Math.abs(n - rounded) < 1e-9 ? rounded : n;
  });
}
