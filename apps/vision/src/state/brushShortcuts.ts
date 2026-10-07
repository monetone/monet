// ─────────────────────────────────────────────────────────────
// Brush keyboard steps — pure helpers for Photoshop's [ / ] (size) and { / }
// (hardness) shortcuts. dir < 0 decreases, dir >= 0 increases. Engine-free so it
// unit-tests in node; the global keydown handler calls these with the live brush.
// ─────────────────────────────────────────────────────────────

/** Brush-size step ([ and ]): ±2 px, clamped to a 1 px minimum. */
export function stepBrushSize(size: number, dir: number): number {
  return dir < 0 ? Math.max(1, size - 2) : size + 2;
}

/** Brush-hardness step ({ and }): ±0.25, clamped to 0..1 (rounded to 2 dp). */
export function stepBrushHardness(hardness: number, dir: number): number {
  const next = hardness + (dir < 0 ? -0.25 : 0.25);
  return Math.max(0, Math.min(1, Math.round(next * 100) / 100));
}
