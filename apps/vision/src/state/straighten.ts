// ─────────────────────────────────────────────────────────────
// Ruler ▸ Straighten — pure angle math for the Ruler tool's "Straighten Layer"
// button (Photoshop). Given the measured line vector (dx,dy in screen space, y
// pointing down), return the clockwise degrees to feed the engine's rotate_arbitrary
// so the line becomes axis-aligned. Engine-free so it unit-tests in node.
// ─────────────────────────────────────────────────────────────

/** Clockwise degrees to rotate the canvas so the measured line (dx,dy) becomes
 *  horizontal — or vertical when the line is closer to vertical. The line's angle
 *  is reduced to its deviation from the nearest 90° axis, so the result is in
 *  [-45, 45]. A zero-length line returns 0. */
export function straightenAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const raw = Math.atan2(dy, dx) * 180 / Math.PI; // screen-space angle, CW positive (y down)
  const dev = raw - 90 * Math.round(raw / 90); // deviation from the nearest axis, [-45, 45]
  return dev === 0 ? 0 : -dev; // rotate the opposite way to cancel the deviation (avoid -0)
}
