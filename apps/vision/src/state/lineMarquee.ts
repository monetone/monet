// ─────────────────────────────────────────────────────────────
// Single Row / Single Column Marquee — pure geometry for the 1px-line selection
// tools. Engine-free so it unit-tests in node; CanvasView passes the rect to
// engine.select_rect.
//
// Photoshop: Single Row selects a 1px-tall row across the full width at the
// clicked y; Single Column selects a 1px-wide column across the full height at
// the clicked x. The line is clamped to stay on the canvas.
// ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** A 1px-tall selection spanning the full width at row `y` (clamped). */
export function singleRowRect(y: number, docW: number, docH: number): { x: number; y: number; w: number; h: number } {
  return { x: 0, y: clamp(Math.round(y), 0, Math.max(0, docH - 1)), w: docW, h: 1 };
}

/** A 1px-wide selection spanning the full height at column `x` (clamped). */
export function singleColumnRect(x: number, docW: number, docH: number): { x: number; y: number; w: number; h: number } {
  return { x: clamp(Math.round(x), 0, Math.max(0, docW - 1)), y: 0, w: 1, h: docH };
}
