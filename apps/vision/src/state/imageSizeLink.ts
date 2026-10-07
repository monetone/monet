// ─────────────────────────────────────────────────────────────
// Image Size "Constrain Proportions" — pure aspect-link helpers for the Image Size
// dialog (Photoshop's chain icon). Given the document's original dimensions, derive
// the partner dimension that preserves the origW:origH aspect. Engine-free so it
// unit-tests in node; the dialog wires these to the Width/Height fields.
// ─────────────────────────────────────────────────────────────

/** Height that preserves origW:origH for a new width, rounded and clamped to >= 1. */
export function linkedHeight(newW: number, origW: number, origH: number): number {
  if (origW <= 0 || origH <= 0) return Math.max(1, Math.round(newW));
  return Math.max(1, Math.round(newW * origH / origW));
}

/** Width that preserves origW:origH for a new height, rounded and clamped to >= 1. */
export function linkedWidth(newH: number, origW: number, origH: number): number {
  if (origW <= 0 || origH <= 0) return Math.max(1, Math.round(newH));
  return Math.max(1, Math.round(newH * origW / origH));
}

// ── Pixels / Percent units (Photoshop's per-field unit menu) ──────────
export type SizeUnit = "px" | "percent";

/** Resolve a field value in the given unit to absolute pixels (>= 1). Percent is
 *  relative to the original dimension (50% of 200 = 100). */
export function resolveImageSize(value: number, unit: SizeUnit, original: number): number {
  const px = unit === "percent" ? (original * value) / 100 : value;
  return Math.max(1, Math.round(px));
}

/** The percentage a pixel dimension is of its original (>= 1; 100 when original<=0). */
export function toPercent(px: number, original: number): number {
  if (original <= 0) return 100;
  return Math.max(1, Math.round((px / original) * 100));
}
