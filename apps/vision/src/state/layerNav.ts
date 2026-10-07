// Photoshop's "select previous/next layer" navigation (Alt+[ / Alt+]). Pure /
// engine-free: maps the active layer's index to the row to select. layers is
// top-first (index 0 renders at the top of the panel), so delta < 0 moves up.

// The index to select when stepping by `delta` from `current` over `count` rows.
// Returns -1 when there are no layers; clamps in-range; `toEnd` jumps straight to
// the first (delta < 0) or last row in that direction.
export function adjacentLayerIndex(current: number, count: number, delta: number, toEnd = false): number {
  if (count <= 0) return -1;
  if (toEnd) return delta < 0 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, current + delta));
}
