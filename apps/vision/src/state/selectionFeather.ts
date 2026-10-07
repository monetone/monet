// ─────────────────────────────────────────────────────────────
// Selection feather — pure helpers for the selection tools' options-bar Feather
// (Photoshop). The marquee/lasso Feather softens new selections at creation. These
// clamp the px input and decide when a feather is worth applying. Engine-free so it
// unit-tests in node; CanvasView calls feather_selection with the result.
// ─────────────────────────────────────────────────────────────

const MAX_FEATHER = 1000; // Photoshop's marquee/lasso feather range is 0–1000 px

/** Clamp a feather radius to [0, 1000], rounded to an integer. */
export function clampFeather(px: number): number {
  return Math.max(0, Math.min(MAX_FEATHER, Math.round(px) || 0));
}

/** Whether a feather radius is large enough to have an effect (the engine ignores
 *  radii below 0.5). */
export function featherActive(px: number): boolean {
  return px >= 0.5;
}

/** The selection tools whose options bar carries the Feather field (Photoshop:
 *  marquee, ellipse, lasso, polygonal lasso and magic wand — not single row/column,
 *  which select a 1px line). Single source of truth for the options-bar gates. */
export function supportsFeather(tool: string): boolean {
  return tool === "marquee" || tool === "ellipse" || tool === "lasso" || tool === "polylasso" || tool === "magneticlasso" || tool === "wand" || tool === "quickselection";
}
