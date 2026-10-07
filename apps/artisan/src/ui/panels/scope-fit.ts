// ─────────────────────────────────────────────────────────────
// ui/panels/scope-fit — offscreen analysis surface for the scope panels
// ─────────────────────────────────────────────────────────────
// The waveform/vectorscope panels render the active artboard offscreen and read
// the whole surface back. A square surface letterboxes a non-square artboard,
// which is not merely wasted pixels: the waveform's x axis is the *surface* x
// axis, so a portrait artboard gets squeezed into a narrow band in the middle of
// the scope, and whatever sits in the letterbox (neighbouring artboards — the
// engine paints every artboard page) is analysed as if it were the artwork.
// Sizing the surface to the artboard's aspect ratio makes the artboard fill it.

export interface ArtboardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScopeFit {
  /** Offscreen surface size (px); the longest side is `budget`. */
  width: number;
  height: number;
  /** View transform placing the artboard flush against the surface. */
  zoom: number;
  panX: number;
  panY: number;
}

/** Fit `ab` into a surface whose longest side is `budget` px, aspect-matched. */
export function scopeFit(ab: ArtboardRect, budget: number): ScopeFit {
  const px = (v: number) => (Number.isFinite(v) ? Math.min(budget, Math.max(1, Math.round(v))) : budget);
  const landscape = ab.width >= ab.height;
  const width = landscape ? budget : px((budget * ab.width) / ab.height);
  const height = landscape ? px((budget * ab.height) / ab.width) : budget;
  // min() keeps the artboard inside after the ≤0.5px rounding above.
  const zoom = Math.min(width / ab.width, height / ab.height);
  return {
    width,
    height,
    zoom,
    panX: width / 2 - (ab.x + ab.width / 2) * zoom,
    panY: height / 2 - (ab.y + ab.height / 2) * zoom,
  };
}
