// straighten — the crop rotation that levels a drawn reference line (Lightroom's
// Straighten ruler in the crop tool). Pure: the angle comes from the line's
// on-screen tilt; CropOverlay writes it to crop.angle. The sign matches
// cropTransform.applyCrop, which rotates displayed content by +crop.angle, so the
// drawn line's on-screen angle plus the returned angle lands on the nearest axis
// (a horizon snaps to level, a wall to vertical).

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The straighten angle (degrees, clamped to ±45) that levels the line from
 *  (x1,y1) to (x2,y2). Coordinates are in the overlay's normalized 0..1 space;
 *  `aspect` is its on-screen width/height, so the tilt is measured in true pixels.
 *  A too-short line (no reliable direction) yields 0. */
export function straightenAngle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  aspect: number,
): number {
  const dxp = (x2 - x1) * aspect;
  const dyp = y2 - y1;
  if (Math.hypot(dxp, dyp) < 1e-4) return 0;
  let deg = (Math.atan2(dyp, dxp) * 180) / Math.PI;
  // A line is undirected — fold its angle to (-90, 90].
  if (deg > 90) deg -= 180;
  else if (deg <= -90) deg += 180;
  // Snap to the nearest axis (horizon = 0°, wall = ±90°); the correction brings
  // the line onto it, since applyCrop shifts the line's angle by +crop.angle.
  const axis = Math.abs(deg) <= 45 ? 0 : deg > 0 ? 90 : -90;
  return clamp(axis - deg, -45, 45);
}
