// ─────────────────────────────────────────────────────────────
// Crop aspect ratios — pure helpers for the Crop tool's Ratio presets. Engine-
// free so they unit-test in node; CanvasView uses them for the live crop preview
// and the commit. A ratio of 0 means "free" (unconstrained).
// ─────────────────────────────────────────────────────────────

export interface AspectPreset {
  key: string;
  label: string;
  ratio: number; // width / height; 0 = free
}

/** The crop Ratio presets shown in the options bar. */
export const CROP_ASPECTS: AspectPreset[] = [
  { key: "free", label: "Free", ratio: 0 },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
  { key: "3:2", label: "3:2", ratio: 3 / 2 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "9:16", label: "9:16", ratio: 9 / 16 },
  { key: "4:5", label: "4:5", ratio: 4 / 5 },
];

/** Ratio for a preset key; unknown keys (and "free") return 0. */
export function aspectRatioFor(key: string): number {
  const p = CROP_ASPECTS.find((a) => a.key === key);
  return p ? p.ratio : 0;
}

/** The largest rect of the given ratio (width/height) that fits inside the drag
 *  box (ax,ay)→(bx,by), anchored at the DRAG START corner (ax,ay), rounded to
 *  ints. Caller must pass ratio > 0; a zero-height drag yields a zero-size
 *  rect. */
export function fitRectToAspect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ratio: number,
): { x0: number; y0: number; w: number; h: number } {
  const dw = Math.abs(bx - ax);
  const dh = Math.abs(by - ay);
  let w: number;
  let h: number;
  if (dh <= 0 || dw / dh > ratio) {
    // wider-than-ratio drag → height-limited
    h = dh;
    w = dh * ratio;
  } else {
    // taller-than-ratio drag → width-limited
    w = dw;
    h = dw / ratio;
  }
  // (#132) Grow away from the mousedown corner, don't re-seat the shrunk rect at
  // the drag box's top-left — that slid the crop off the corner the user grabbed
  // on any up/left drag.
  const x0 = bx >= ax ? ax : ax - w;
  const y0 = by >= ay ? ay : ay - h;
  return { x0: Math.round(x0), y0: Math.round(y0), w: Math.round(w), h: Math.round(h) };
}
