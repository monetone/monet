// ─────────────────────────────────────────────────────────────
// Zoom field — pure parser for the status bar's editable zoom percentage
// (Photoshop). Parses a typed "200" / "200%" into a zoom fraction, clamped to the
// engine's setZoom range [0.02, 32] (2%–3200%). Engine-free so it unit-tests in
// node; the ZoomField component feeds it the input value and calls store.setZoom.
// ─────────────────────────────────────────────────────────────

/** Parse a zoom-percentage string to a clamped zoom fraction, or null if invalid. */
export function parseZoomField(input: string): number | null {
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (!m) return null;
  return Math.max(0.02, Math.min(32, parseFloat(m[1]) / 100));
}
