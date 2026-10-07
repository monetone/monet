// Photoshop's View ▸ Snap To targets. snapToGuides (CanvasView) aligns a dragged
// point to candidate coordinates drawn from three sources — document bounds,
// guides and grid lines — each independently toggleable here. Engine-free.

export interface SnapTargets {
  guides: boolean;
  grid: boolean;
  docBounds: boolean;
}

// Candidate snap coordinates for one axis, honouring the enabled targets:
// document bounds (0 & docSize), each guide position, and grid multiples (only
// when the grid itself is active). Order — bounds, guides, grid — is the
// tie-break priority when two candidates sit equally far from the pointer.
export function axisSnapTargets(
  docSize: number,
  guidePositions: number[],
  grid: { on: boolean; spacing: number },
  targets: SnapTargets,
): number[] {
  const out: number[] = [];
  if (targets.docBounds) out.push(0, docSize);
  if (targets.guides) out.push(...guidePositions);
  if (targets.grid && grid.on) {
    const gs = Math.max(2, grid.spacing);
    for (let g = 0; g <= docSize; g += gs) out.push(g);
  }
  return out;
}

// Snap a value to the NEAREST candidate within the threshold, else leave it
// unchanged.
//
// This used to return the FIRST candidate within the threshold, and the
// candidate list is built in a fixed order (bounds, then guides, then grid) —
// so a document edge or grid line 5px away beat a guide 1px away. Placing a
// guide precisely and then watching the marquee ignore it in favour of the
// canvas edge is the symptom. Photoshop snaps to the nearest target.
//
// Strict `<` on both comparisons keeps the earlier (higher-priority) candidate
// when two are equally close, so the list order still decides exact ties.
export function snapValue(v: number, candidates: number[], threshold: number): number {
  let best = v;
  let bestDistance = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - v);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}
