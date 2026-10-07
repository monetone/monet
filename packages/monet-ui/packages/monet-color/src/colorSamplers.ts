// ─────────────────────────────────────────────────────────────
// Color Sampler tool — pure reducers for the persistent sample points
// (#1..#10). Kept engine-free so they unit-test in node; the Store and the
// canvas pointer handlers delegate to them so the rules live in one place.
//
// Photoshop: the Color Sampler places up to 10 sample points; clicking past the
// cap is ignored, Alt-click removes the nearest, and a point can be dragged to a
// new position. Points store positions only — their colours are read live from
// the composite in the Info panel (Photoshop's colour-monitoring behaviour).
// ─────────────────────────────────────────────────────────────

export interface SamplePoint {
  x: number;
  y: number;
}

/** Photoshop's hard cap on simultaneous colour samplers. */
export const MAX_SAMPLERS = 10;

/** Append a sample point, rounded to whole pixels. Ignored once at the cap —
 *  returns the same list reference so callers can detect the no-op. */
export function addSampler(list: SamplePoint[], x: number, y: number): SamplePoint[] {
  if (list.length >= MAX_SAMPLERS) return list;
  return [...list, { x: Math.round(x), y: Math.round(y) }];
}

/** Index of the sample point nearest (x,y), or -1 when the list is empty. */
export function nearestSamplerIndex(list: SamplePoint[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = (list[i].x - x) ** 2 + (list[i].y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Remove the single sample point nearest (x,y). No-op on an empty list. */
export function removeNearestSampler(list: SamplePoint[], x: number, y: number): SamplePoint[] {
  const i = nearestSamplerIndex(list, x, y);
  return i < 0 ? list : list.filter((_, j) => j !== i);
}

/** Reposition sample point `i` to (x,y), rounded. Out-of-range index is a no-op. */
export function moveSampler(list: SamplePoint[], i: number, x: number, y: number): SamplePoint[] {
  if (i < 0 || i >= list.length) return list;
  return list.map((p, j) => (j === i ? { x: Math.round(x), y: Math.round(y) } : p));
}
